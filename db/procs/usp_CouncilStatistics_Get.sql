/* Council Statistics — the rollup dashboard for a council officer: council-to-council,
   council-to-chapter, and chapter-to-member visibility, plus an aggregate-only financial
   rollup and discipline-case counts. New module; docs/AIS-Project-Documentation.md §2,
   §3 and §10 Decision #7 (amended 2026-09-20) record the two client decisions this proc
   implements:

     1. FINANCIAL DATA IS AGGREGATE ONLY. Per-chapter OpeningBalance/PeriodIn/PeriodOut/
        ClosingBalance, all DECIMAL(18,2), derived EXCLUSIVELY from dbo.LedgerEntry (never
        re-summed from dbo.Expense/dbo.Donation — usp_Dashboard_GetChapterSummary.sql's own
        header calls the ledger "the single source of truth" and that is not weakened here).
        There is NO drill-down: no ledger entry, entry date, description, payee, or entry
        count ever leaves this proc. A chapter's own detailed ledger stays visible only to
        that chapter's own members via usp_Ledger_GetByChapter/usp_Dashboard_GetChapterSummary.
     2. CORRECTIVE-ACTION COUNTS, council-wide AND per-chapter, by status only — same
        invariant #6 boundary usp_Dashboard_GetChapterSummary's 4th result set already
        enforces: a count carries no narrative and no member name, so it stays inside the
        boundary regardless of who is asking.

   READ-AUDIT (client decision, on top of what invariant #10 technically requires — #10
   only mandates this for writes, but a bulk read of every chapter's financial position
   under a subtree is logged anyway): one dbo.AuditLog row, Action='Read', written from
   inside this proc, following the exact procedure-level pattern usp_Enrolment_Redeem.sql
   established (atomic with the read, not a parallel HTTP-level interceptor — CLAUDE.md
   invariant #10 explicitly names that pattern as the one to continue).

   SCOPING (invariant #4 — never trust a caller-supplied id, check it here too even though
   the API layer should have already):
     - @FocusCouncilId NULL  -> resolved to the caller's own highest-level (shallowest)
       currently-seated council (dbo.CouncilLevel.LevelOrder ASC; National=2 is shallower
       than Regional=3, etc. — see db/seed/01_reference.sql).
     - @FocusCouncilId given -> asserted to be inside dbo.fn_MemberCouncilScope(@RequestingMemberId)
       (db/schema/19_scope_functions.sql) — the union of dbo.fn_CouncilSubtree applied to
       every council the caller currently holds a seat on.
     - Holds no council seat at all      -> THROW 51620 (distinct from the next case).
     - Holds a seat, but not over @FocusCouncilId -> THROW 51621.
   Both numbers picked from the free 516xx band — 51600 is already used twice (by
   usp_ChapterInviteLink_Regenerate/_GetOwn) but nothing else in that band is taken; grep
   every usp_*.sql file under db/procs before adding a third THROW to this file.

   FOUR RESULT SETS, IN ORDER:
     1. The focus council, rolled up over its ENTIRE subtree (via fn_CouncilSubtree).
     2. Direct child councils of the focus, each with its OWN full copy of every Set-1
        figure (computed by treating each child as its own root — same rollup logic, not
        a second implementation of it, so the two can never quietly disagree).
     3. EVERY CHAPTER IN THE FOCUS'S ENTIRE SUBTREE (not just direct children — see the
        note in this file's body: chapters hang off City/Municipal councils in the real
        seeded structure, so a National-focused view has zero DIRECT chapters; walking
        only direct children would make this screen useless for the exact officer who
        asked for it), paged by @Skip/@Take.
     4. Council-wide corrective-action totals for the whole focus subtree, one row per
        canonical status, zero-filled — same shape as usp_Dashboard_GetChapterSummary's
        4th result set, scoped to a subtree instead of one chapter.

   No cursor anywhere in this proc — task 1's two inline TVFs exist specifically so this
   proc never needs one. Every bit-typed column is CAST(...AS BIT) explicitly — a bare
   CASE WHEN...THEN 1 ELSE 0 END infers INT and 500s Dapper's constructor match with no
   client-visible detail; this is exactly what happened live in
   usp_ChapterRegistration_GetQueue's CanAct column (CLAUDE.md §8.7) and is not repeated
   here. */
CREATE OR ALTER PROCEDURE dbo.usp_CouncilStatistics_Get
    @RequestingMemberId INT,
    @FocusCouncilId     INT = NULL,
    @FromDate           DATE,
    @ToDate             DATE,
    @Skip               INT = 0,
    @Take               INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    /* ---------- Scoping (invariant #4) ---------- */
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId))
        THROW 51620, 'You do not currently hold a council office, so there is no statistics view to show.', 1;

    IF @FocusCouncilId IS NULL
    BEGIN
        SELECT TOP (1) @FocusCouncilId = mr.ScopeId
        FROM   dbo.MemberRole mr
               JOIN dbo.Council      c  ON c.CouncilId = mr.ScopeId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council'
          AND  mr.TermStart <= @Today
          AND  (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        ORDER BY cl.LevelOrder ASC, mr.ScopeId ASC;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc WHERE sc.CouncilId = @FocusCouncilId)
            THROW 51621, 'That council is outside what you are permitted to view.', 1;
    END

    /* ---------- Read-audit (client decision — see header) ---------- */
    INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
    VALUES ('CouncilStatistics', CAST(@FocusCouncilId AS NVARCHAR(40)), 'Read',
            CONCAT(N'{"FocusCouncilId":', @FocusCouncilId,
                   N',"FromDate":"', CONVERT(NVARCHAR(10), @FromDate, 23),
                   N'","ToDate":"',  CONVERT(NVARCHAR(10), @ToDate, 23), N'"}'),
            @RequestingMemberId);

    /* ---------- Shared rollup: the focus council itself + its direct children ----------
       Both Set 1 and Set 2 are the exact same computation, applied to a different root —
       Set 1 to @FocusCouncilId, Set 2 to each of its direct children — so the two result
       sets can never drift apart. @Roots drives it; @Rollup holds the computed figures. */
    DECLARE @Roots TABLE (CouncilId INT PRIMARY KEY);
    INSERT INTO @Roots (CouncilId) VALUES (@FocusCouncilId);
    INSERT INTO @Roots (CouncilId)
    SELECT CouncilId FROM dbo.Council WHERE ParentCouncilId = @FocusCouncilId;

    DECLARE @Rollup TABLE (
        CouncilId               INT PRIMARY KEY,
        CouncilName             NVARCHAR(150),
        LevelName               NVARCHAR(50),
        ParentCouncilId         INT NULL,
        Depth                   INT,
        HasSeatedOfficers       BIT,
        DirectChildCouncilCount INT,
        TotalCouncilsInSubtree  INT,
        DirectChapterCount      INT,
        TotalChaptersInSubtree  INT,
        ActiveChapterCount      INT,
        InactiveChapterCount    INT,
        MemberTotal             INT,
        MemberPending           INT,
        MemberApproved          INT,
        MemberActive            INT,
        MemberInactive          INT,
        MemberSuspended         INT,
        MemberRejected          INT,
        NewThisPeriod           INT,
        DetachedMemberCount     INT,
        RenewedCount            INT,
        LapsedCount             INT,
        ExemptCount             INT,
        NotRecordedCount        INT,
        HasRenewalData          BIT,
        RegSubmittedCount               INT,
        RegReturnedForCorrectionCount   INT,
        RegApprovedCount                INT,
        MeetingsHeld             INT,
        TotalPresent             INT,
        TotalOnSheets            INT,
        AveragePresentPerMeeting DECIMAL(18,2)
    );

    INSERT INTO @Rollup
    SELECT
        r.CouncilId,
        c.CouncilName,
        cl.LevelName,
        c.ParentCouncilId,
        0 AS Depth,   -- each root's own subtree walk begins at itself
        dbo.fn_CouncilHasSeatedOfficers(r.CouncilId),
        ISNULL(childCouncils.DirectChildCouncilCount, 0),
        ISNULL(allCouncils.TotalCouncilsInSubtree, 0),
        ISNULL(directChapters.DirectChapterCount, 0),
        ISNULL(subtreeChapters.TotalChaptersInSubtree, 0),
        ISNULL(subtreeChapters.ActiveChapterCount, 0),
        ISNULL(subtreeChapters.InactiveChapterCount, 0),
        ISNULL(memAgg.MemberTotal, 0),
        ISNULL(memAgg.MemberPending, 0),
        ISNULL(memAgg.MemberApproved, 0),
        ISNULL(memAgg.MemberActive, 0),
        ISNULL(memAgg.MemberInactive, 0),
        ISNULL(memAgg.MemberSuspended, 0),
        ISNULL(memAgg.MemberRejected, 0),
        ISNULL(memAgg.NewThisPeriod, 0),
        ISNULL(detachedAgg.DetachedMemberCount, 0),
        ISNULL(renAgg.RenewedCount, 0),
        ISNULL(renAgg.LapsedCount, 0),
        ISNULL(renAgg.ExemptCount, 0),
        /* Never negative: a renewal season that pre-dates the current roster snapshot
           could in principle have more recorded rows than members counted above; clamp
           rather than surface a nonsensical negative "not recorded" figure. */
        CASE WHEN ISNULL(memAgg.MemberTotal, 0) - ISNULL(renAgg.RecordedCount, 0) < 0 THEN 0
             ELSE ISNULL(memAgg.MemberTotal, 0) - ISNULL(renAgg.RecordedCount, 0) END,
        CAST(CASE WHEN ISNULL(renAgg.RecordedCount, 0) > 0 THEN 1 ELSE 0 END AS BIT),
        ISNULL(regAgg.RegSubmittedCount, 0),
        ISNULL(regAgg.RegReturnedForCorrectionCount, 0),
        ISNULL(regAgg.RegApprovedCount, 0),
        ISNULL(meetAgg.MeetingsHeld, 0),
        ISNULL(attAgg.TotalPresent, 0),
        ISNULL(attAgg.TotalOnSheets, 0),
        ISNULL(CAST(attAgg.TotalPresent AS DECIMAL(18,2)) / NULLIF(meetAgg.MeetingsHeld, 0), 0)
    FROM @Roots r
         JOIN dbo.Council      c  ON c.CouncilId = r.CouncilId
         JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
         OUTER APPLY (
             SELECT COUNT(*) AS DirectChildCouncilCount
             FROM   dbo.Council cc WHERE cc.ParentCouncilId = r.CouncilId
         ) childCouncils
         OUTER APPLY (
             SELECT COUNT(*) AS TotalCouncilsInSubtree
             FROM   dbo.fn_CouncilSubtree(r.CouncilId)
         ) allCouncils
         OUTER APPLY (
             SELECT COUNT(*) AS DirectChapterCount
             FROM   dbo.Chapter ch WHERE ch.ParentCouncilId = r.CouncilId
         ) directChapters
         OUTER APPLY (
             SELECT
                 COUNT(*) AS TotalChaptersInSubtree,
                 SUM(CASE WHEN ch.IsActive = 1 THEN 1 ELSE 0 END) AS ActiveChapterCount,
                 SUM(CASE WHEN ch.IsActive = 0 THEN 1 ELSE 0 END) AS InactiveChapterCount
             FROM   dbo.Chapter ch
             WHERE  ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
         ) subtreeChapters
         OUTER APPLY (
             /* All six dbo.MemberStatus values so Total reconciles — copied wholesale
                from usp_Dashboard_GetChapterSummary.sql's own membership result set.
                Scoped through Chapter, which naturally excludes detached/HomeCouncilId
                members (invariant #14) — counted separately below, never folded in here. */
             SELECT
                 COUNT(*) AS MemberTotal,
                 SUM(CASE WHEN ms.StatusName = 'Pending'   THEN 1 ELSE 0 END) AS MemberPending,
                 SUM(CASE WHEN ms.StatusName = 'Approved'  THEN 1 ELSE 0 END) AS MemberApproved,
                 SUM(CASE WHEN ms.StatusName = 'Active'    THEN 1 ELSE 0 END) AS MemberActive,
                 SUM(CASE WHEN ms.StatusName = 'Inactive'  THEN 1 ELSE 0 END) AS MemberInactive,
                 SUM(CASE WHEN ms.StatusName = 'Suspended' THEN 1 ELSE 0 END) AS MemberSuspended,
                 SUM(CASE WHEN ms.StatusName = 'Rejected'  THEN 1 ELSE 0 END) AS MemberRejected,
                 SUM(CASE WHEN m.ApprovedDate >= @FromDate
                           AND  m.ApprovedDate <  DATEADD(DAY, 1, @ToDate) THEN 1 ELSE 0 END) AS NewThisPeriod
             FROM   dbo.Member m
                    JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
                    JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId
             WHERE  m.IsDeleted = 0
               AND  ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
         ) memAgg
         OUTER APPLY (
             /* Invariant #14: a detached member's home is a council, never a chapter.
                Counted here, separately, keyed directly off HomeCouncilId — never folded
                into any chapter's or council's member totals above. */
             SELECT COUNT(*) AS DetachedMemberCount
             FROM   dbo.Member m
             WHERE  m.IsDeleted = 0
               AND  m.HomeCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
         ) detachedAgg
         OUTER APPLY (
             /* "For the period" = any ChapterRenewal whose RenewalPeriod overlaps
                [@FromDate, @ToDate]. RecordedCount lets the caller distinguish "zero
                renewals happened" from "no renewal season has ever been recorded here
                at all" via HasRenewalData above — there is likely no MemberRenewal data
                whatsoever in this environment yet. */
             SELECT
                 SUM(CASE WHEN mrn.RenewalStatus = 'Renewed' THEN 1 ELSE 0 END) AS RenewedCount,
                 SUM(CASE WHEN mrn.RenewalStatus = 'Lapsed'  THEN 1 ELSE 0 END) AS LapsedCount,
                 SUM(CASE WHEN mrn.RenewalStatus = 'Exempt'  THEN 1 ELSE 0 END) AS ExemptCount,
                 COUNT(*) AS RecordedCount
             FROM   dbo.MemberRenewal mrn
                    JOIN dbo.ChapterRenewal cr  ON cr.RenewalId = mrn.RenewalId
                    JOIN dbo.RenewalPeriod  rp  ON rp.PeriodId  = cr.PeriodId
                    JOIN dbo.Chapter        ch2 ON ch2.ChapterId = cr.ChapterId
             WHERE  ch2.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
               AND  rp.OpensDate  <= @ToDate
               AND  rp.ClosesDate >= @FromDate
         ) renAgg
         OUTER APPLY (
             /* dbo.ChapterRegistrationStatus has EXACTLY three canonical rows, forever
                (17_chapter_registration.sql's own header) — Submitted, ReturnedForCorrection,
                Approved; no 'Rejected' row exists for this lifecycle. Scoped by
                ActingCouncilId within the subtree, same scope usp_ChapterRegistration_GetQueue
                already established as correct for "registrations this council may see". */
             SELECT
                 SUM(CASE WHEN s.StatusName = 'Submitted'             THEN 1 ELSE 0 END) AS RegSubmittedCount,
                 SUM(CASE WHEN s.StatusName = 'ReturnedForCorrection' THEN 1 ELSE 0 END) AS RegReturnedForCorrectionCount,
                 SUM(CASE WHEN s.StatusName = 'Approved'              THEN 1 ELSE 0 END) AS RegApprovedCount
             FROM   dbo.ChapterRegistration cr3
                    JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr3.StatusId
             WHERE  cr3.ActingCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
         ) regAgg
         OUTER APPLY (
             SELECT COUNT(*) AS MeetingsHeld
             FROM   dbo.Meeting m2
                    JOIN dbo.Chapter ch3 ON ch3.ChapterId = m2.ChapterId
             WHERE  ch3.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
               AND  m2.IsFinalized = 1
               AND  m2.MeetingDate BETWEEN @FromDate AND @ToDate
         ) meetAgg
         OUTER APPLY (
             /* Headcount first, matching usp_Dashboard_GetChapterSummary's own rule —
                attendance is never broken down per member (invariant #5/#6 adjacent: no
                per-member figure of any kind belongs on a rollup screen either). */
             SELECT
                 ISNULL(SUM(CASE WHEN ast.StatusName = 'Present' THEN 1 ELSE 0 END), 0) AS TotalPresent,
                 COUNT(*) AS TotalOnSheets
             FROM   dbo.MeetingAttendance ma
                    JOIN dbo.Meeting m3 ON m3.MeetingId = ma.MeetingId
                    JOIN dbo.Chapter ch4 ON ch4.ChapterId = m3.ChapterId
                    JOIN dbo.AttendanceStatus ast ON ast.AttendanceStatusId = ma.AttendanceStatusId
             WHERE  ch4.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(r.CouncilId))
               AND  m3.IsFinalized = 1
               AND  m3.MeetingDate BETWEEN @FromDate AND @ToDate
         ) attAgg;

    /* ---------- Set 1 — the focus node ---------- */
    SELECT * FROM @Rollup WHERE CouncilId = @FocusCouncilId;

    /* ---------- Set 2 — direct child councils, each fully rolled up ---------- */
    SELECT * FROM @Rollup WHERE CouncilId <> @FocusCouncilId ORDER BY CouncilName;

    /* ---------- Set 3 — every chapter in the focus's ENTIRE subtree, paged ----------
       CORRECTION baked in on purpose: chapters hang off City/Municipal councils in the
       real seeded structure (db/seed/02_demo_chapter.sql), so a National-focused view has
       ZERO direct chapters. This walks the whole subtree via fn_CouncilSubtree, never just
       dbo.Chapter WHERE ParentCouncilId = @FocusCouncilId — that shape would make the
       screen empty for the exact National officer who asked for it. */
    SELECT
        sch.ChapterId,
        sch.ChapterName,
        sch.Barangay,
        sch.ParentCouncilId,
        sch.ParentCouncilName,
        sch.IsActive,
        ISNULL(mem.MemberTotal, 0)     AS MemberTotal,
        ISNULL(mem.MemberPending, 0)   AS MemberPending,
        ISNULL(mem.MemberApproved, 0)  AS MemberApproved,
        ISNULL(mem.MemberActive, 0)    AS MemberActive,
        ISNULL(mem.MemberInactive, 0)  AS MemberInactive,
        ISNULL(mem.MemberSuspended, 0) AS MemberSuspended,
        ISNULL(mem.MemberRejected, 0)  AS MemberRejected,
        ISNULL(mem.NewThisPeriod, 0)   AS NewThisPeriod,
        ISNULL(ren.RenewedCount, 0) AS RenewedCount,
        ISNULL(ren.LapsedCount, 0)  AS LapsedCount,
        ISNULL(ren.ExemptCount, 0)  AS ExemptCount,
        CASE WHEN ISNULL(mem.MemberTotal, 0) - ISNULL(ren.RecordedCount, 0) < 0 THEN 0
             ELSE ISNULL(mem.MemberTotal, 0) - ISNULL(ren.RecordedCount, 0) END AS NotRecordedCount,
        CAST(CASE WHEN ISNULL(ren.RecordedCount, 0) > 0 THEN 1 ELSE 0 END AS BIT) AS HasRenewalData,
        ISNULL(actCount.MeetingsHeld, 0) AS MeetingsHeld,
        ISNULL(actAtt.TotalPresent, 0)   AS TotalPresent,
        ISNULL(actAtt.TotalOnSheets, 0)  AS TotalOnSheets,
        ISNULL(CAST(actAtt.TotalPresent AS DECIMAL(18,2)) / NULLIF(actCount.MeetingsHeld, 0), 0) AS AveragePresentPerMeeting,
        /* Financial — dbo.LedgerEntry ONLY (invariant #1's own single-source-of-truth
           rule, and the amendment's boundary: these four aggregate columns and NOTHING
           else — no SourceType split, no entry list, no entry count). Single-pass
           equivalent of usp_Dashboard_GetChapterSummary.sql's 3-CTE version (Opening =
           net of entries before @FromDate; PeriodIn/Out = entries in [@FromDate,@ToDate]
           split by EntryType; Closing = Opening + PeriodIn - PeriodOut) — reformulated as
           one CASE-driven scan per chapter, scanning IX_Ledger_Chapter_Date once instead
           of three times, because this proc computes it once per chapter across an entire
           subtree rather than once for a single chapter. Cross-checked to produce
           identical figures to usp_Dashboard_GetChapterSummary for the same chapter and
           date range — see this module's own verification notes. */
        ISNULL(fin.OpeningBalance, 0) AS OpeningBalance,
        ISNULL(fin.PeriodIn, 0)       AS PeriodIn,
        ISNULL(fin.PeriodOut, 0)      AS PeriodOut,
        ISNULL(fin.OpeningBalance, 0) + ISNULL(fin.PeriodIn, 0) - ISNULL(fin.PeriodOut, 0) AS ClosingBalance,
        ISNULL(disc.CaseCountPending, 0)     AS CaseCountPending,
        ISNULL(disc.CaseCountUnderReview, 0) AS CaseCountUnderReview,
        ISNULL(disc.CaseCountReconciled, 0)  AS CaseCountReconciled,
        ISNULL(disc.CaseCountDismissed, 0)   AS CaseCountDismissed,
        COUNT(*) OVER() AS TotalCount
    FROM (
        SELECT ch.ChapterId, ch.ChapterName, ch.Barangay, ch.IsActive,
               ch.ParentCouncilId, pc.CouncilName AS ParentCouncilName
        FROM   dbo.Chapter ch
               JOIN dbo.Council pc ON pc.CouncilId = ch.ParentCouncilId
        WHERE  ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(@FocusCouncilId))
    ) sch
    OUTER APPLY (
        SELECT
            COUNT(*) AS MemberTotal,
            SUM(CASE WHEN ms.StatusName = 'Pending'   THEN 1 ELSE 0 END) AS MemberPending,
            SUM(CASE WHEN ms.StatusName = 'Approved'  THEN 1 ELSE 0 END) AS MemberApproved,
            SUM(CASE WHEN ms.StatusName = 'Active'    THEN 1 ELSE 0 END) AS MemberActive,
            SUM(CASE WHEN ms.StatusName = 'Inactive'  THEN 1 ELSE 0 END) AS MemberInactive,
            SUM(CASE WHEN ms.StatusName = 'Suspended' THEN 1 ELSE 0 END) AS MemberSuspended,
            SUM(CASE WHEN ms.StatusName = 'Rejected'  THEN 1 ELSE 0 END) AS MemberRejected,
            SUM(CASE WHEN m.ApprovedDate >= @FromDate
                      AND  m.ApprovedDate <  DATEADD(DAY, 1, @ToDate) THEN 1 ELSE 0 END) AS NewThisPeriod
        FROM   dbo.Member m
               JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId
        WHERE  m.ChapterId = sch.ChapterId
          AND  m.IsDeleted = 0
    ) mem
    OUTER APPLY (
        SELECT
            SUM(CASE WHEN mrn.RenewalStatus = 'Renewed' THEN 1 ELSE 0 END) AS RenewedCount,
            SUM(CASE WHEN mrn.RenewalStatus = 'Lapsed'  THEN 1 ELSE 0 END) AS LapsedCount,
            SUM(CASE WHEN mrn.RenewalStatus = 'Exempt'  THEN 1 ELSE 0 END) AS ExemptCount,
            COUNT(*) AS RecordedCount
        FROM   dbo.MemberRenewal mrn
               JOIN dbo.ChapterRenewal cr ON cr.RenewalId = mrn.RenewalId
               JOIN dbo.RenewalPeriod  rp ON rp.PeriodId  = cr.PeriodId
        WHERE  cr.ChapterId = sch.ChapterId
          AND  rp.OpensDate  <= @ToDate
          AND  rp.ClosesDate >= @FromDate
    ) ren
    OUTER APPLY (
        SELECT COUNT(*) AS MeetingsHeld
        FROM   dbo.Meeting m2
        WHERE  m2.ChapterId = sch.ChapterId
          AND  m2.IsFinalized = 1
          AND  m2.MeetingDate BETWEEN @FromDate AND @ToDate
    ) actCount
    OUTER APPLY (
        SELECT
            ISNULL(SUM(CASE WHEN ast.StatusName = 'Present' THEN 1 ELSE 0 END), 0) AS TotalPresent,
            COUNT(*) AS TotalOnSheets
        FROM   dbo.MeetingAttendance ma
               JOIN dbo.Meeting m3 ON m3.MeetingId = ma.MeetingId
               JOIN dbo.AttendanceStatus ast ON ast.AttendanceStatusId = ma.AttendanceStatusId
        WHERE  m3.ChapterId = sch.ChapterId
          AND  m3.IsFinalized = 1
          AND  m3.MeetingDate BETWEEN @FromDate AND @ToDate
    ) actAtt
    OUTER APPLY (
        SELECT
            ISNULL(SUM(CASE WHEN le.EntryDate < @FromDate
                            THEN (CASE WHEN le.EntryType = 'In' THEN le.Amount ELSE -le.Amount END)
                            ELSE 0 END), 0) AS OpeningBalance,
            ISNULL(SUM(CASE WHEN le.EntryDate BETWEEN @FromDate AND @ToDate AND le.EntryType = 'In'
                            THEN le.Amount ELSE 0 END), 0) AS PeriodIn,
            ISNULL(SUM(CASE WHEN le.EntryDate BETWEEN @FromDate AND @ToDate AND le.EntryType = 'Out'
                            THEN le.Amount ELSE 0 END), 0) AS PeriodOut
        FROM   dbo.LedgerEntry le
        WHERE  le.ChapterId = sch.ChapterId
          AND  le.EntryDate <= @ToDate
    ) fin
    OUTER APPLY (
        SELECT
            SUM(CASE WHEN ca.StatusName = 'Pending'      THEN 1 ELSE 0 END) AS CaseCountPending,
            SUM(CASE WHEN ca.StatusName = 'Under Review' THEN 1 ELSE 0 END) AS CaseCountUnderReview,
            SUM(CASE WHEN ca.StatusName = 'Reconciled'   THEN 1 ELSE 0 END) AS CaseCountReconciled,
            SUM(CASE WHEN ca.StatusName = 'Dismissed'    THEN 1 ELSE 0 END) AS CaseCountDismissed
        FROM   dbo.CorrectiveAction ca
        WHERE  ca.ChapterId  = sch.ChapterId
          AND  ca.DateFiled BETWEEN @FromDate AND @ToDate
    ) disc
    ORDER BY sch.ChapterName
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;

    /* ---------- Set 4 — council-wide corrective-action totals, zero-filled ----------
       Same shape as usp_Dashboard_GetChapterSummary's 4th result set, scoped to every
       chapter in the focus subtree instead of one chapter. Counts by status only — no
       case list, no member name, no narrative (invariant #6). */
    SELECT
        v.StatusName,
        ISNULL(cnt.Cnt, 0) AS CaseCount
    FROM (VALUES ('Pending'), ('Under Review'), ('Reconciled'), ('Dismissed')) AS v(StatusName)
        OUTER APPLY (
            SELECT COUNT(*) AS Cnt
            FROM   dbo.CorrectiveAction ca
                   JOIN dbo.Chapter ch ON ch.ChapterId = ca.ChapterId
            WHERE  ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(@FocusCouncilId))
              AND  ca.StatusName = v.StatusName
              AND  ca.DateFiled BETWEEN @FromDate AND @ToDate
        ) cnt
    ORDER BY v.StatusName;
END
GO
