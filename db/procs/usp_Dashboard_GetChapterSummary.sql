/* Chapter Dashboard — read-only, date-ranged overview. Visible to EVERY member of the
   chapter, not officer-only (docs §4.7), scoped exactly like usp_Ledger_GetSummary:
   any undeleted member of @ChapterId may call this, nobody else.

   @FromDate/@ToDate are REQUIRED and are never defaulted here. The membership-year
   default (09 Aug -> 08 Aug, CLAUDE.md §3 / src/Akrho.Domain/MembershipYear.cs) is an
   API-layer decision — this proc only ever answers "give me the figures for this
   explicit range", so there is exactly one place (C#) that decides what "this year"
   means, and it can change without touching SQL.

   Four result sets. Every aggregate is CHAPTER-WIDE ONLY — no per-member figure of any
   kind appears anywhere in this proc (CLAUDE.md invariant #5, decision 2):

     1. Financial   — derived from dbo.LedgerEntry ONLY, never re-summed from
                       dbo.Expense/dbo.Donation directly (decision 3). The ledger is the
                       single source of truth (docs §4.6); a figure that doesn't tie to
                       the real balance the moment something is voided/reversed is a
                       second set of books.
     2. Membership   — headcounts by MemberStatus, plus NewThisPeriod.
     3. Activity     — meetings held, attendance as a HEADCOUNT first
                       ("N present of M on the sheet"), matching
                       usp_Meeting_GetByChapter's own rule that attendance is never
                       broken down per member. AveragePresentPerMeeting is a chapter-wide
                       mean, not a collection rate and not an arrears figure
                       (CLAUDE.md invariant #5 / docs §4.3 — attendance percentage is
                       explicitly sanctioned; a contribution/collection rate never is).
     4. Corrective   — COUNTS by status only. No case list, no member name, no
        actions       narrative — a count carries neither, so this stays inside
                       invariant #6 regardless of who is asking.

   OpeningBalance / ClosingBalance / PeriodIn / PeriodOut are period figures and are
   never relabeled as "the balance" (decision 4). CurrentBalance is the same all-time
   net dbo.usp_Ledger_GetSummary would return right now, computed independently of
   @FromDate/@ToDate, and always returned alongside the period figures so a caller can
   never mistake one for the other.

   Renewal state (Renewed/Lapsed/Exempt) is explicitly OUT OF SCOPE (decision 5) —
   Member.RenewedThrough is written by the Portal, which does not exist yet. */
CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_GetChapterSummary
    @ChapterId          INT,
    @RequestingMemberId INT,
    @FromDate           DATE,
    @ToDate             DATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51258, 'Not permitted to read this chapter''s dashboard.', 1;

    /* ---------- 1. Financial — dbo.LedgerEntry only ---------- */
    ;WITH Opening AS (
        SELECT ISNULL(SUM(CASE WHEN EntryType = 'In' THEN Amount ELSE -Amount END), 0) AS OpeningBalance
        FROM   dbo.LedgerEntry
        WHERE  ChapterId = @ChapterId AND EntryDate < @FromDate
    ),
    PeriodRows AS (
        SELECT EntryType, SourceType, Amount
        FROM   dbo.LedgerEntry
        WHERE  ChapterId = @ChapterId
          AND  EntryDate BETWEEN @FromDate AND @ToDate
    ),
    Period AS (
        SELECT
            ISNULL(SUM(CASE WHEN EntryType = 'In'  THEN Amount ELSE 0 END), 0) AS PeriodIn,
            ISNULL(SUM(CASE WHEN EntryType = 'Out' THEN Amount ELSE 0 END), 0) AS PeriodOut,
            ISNULL(SUM(CASE WHEN EntryType = 'In'  AND SourceType = 'Meeting'  THEN Amount ELSE 0 END), 0) AS InFromMeetings,
            ISNULL(SUM(CASE WHEN EntryType = 'In'  AND SourceType = 'Donation' THEN Amount ELSE 0 END), 0) AS InFromDonations,
            ISNULL(SUM(CASE WHEN EntryType = 'In'  AND SourceType NOT IN ('Meeting','Donation') THEN Amount ELSE 0 END), 0) AS InOther,
            ISNULL(SUM(CASE WHEN EntryType = 'Out' AND SourceType = 'Expense'  THEN Amount ELSE 0 END), 0) AS OutOnExpenses,
            ISNULL(SUM(CASE WHEN EntryType = 'Out' AND SourceType NOT IN ('Expense') THEN Amount ELSE 0 END), 0) AS OutOther
        FROM PeriodRows
    ),
    CurrentAllTime AS (
        SELECT ISNULL(SUM(CASE WHEN EntryType = 'In' THEN Amount ELSE -Amount END), 0) AS CurrentBalance
        FROM   dbo.LedgerEntry
        WHERE  ChapterId = @ChapterId
    )
    SELECT
        o.OpeningBalance,
        p.PeriodIn,
        p.PeriodOut,
        o.OpeningBalance + p.PeriodIn - p.PeriodOut AS ClosingBalance,
        c.CurrentBalance,
        p.InFromMeetings,
        p.InFromDonations,
        p.InOther,
        p.OutOnExpenses,
        p.OutOther
    FROM Opening o CROSS JOIN Period p CROSS JOIN CurrentAllTime c;

    /* ---------- 2. Membership — headcounts only, no per-member row ----------
       Actual dbo.MemberStatus seed values are Pending, Approved, Active, Inactive,
       Suspended, Rejected (db/seed/01_reference.sql) — two more than the four the
       brief assumed (Active/Inactive/Suspended/Pending). All six are counted here so
       Total always reconciles; Approved and Rejected are additional, not substitutes.
       Scoped ChapterId = @ChapterId AND IsDeleted = 0 throughout, which naturally
       excludes detached/council-attached members (CLAUDE.md invariant #14) — correct,
       since a chapter's dashboard is about its own roster. */
    SELECT
        COUNT(*) AS Total,
        SUM(CASE WHEN ms.StatusName = 'Pending'   THEN 1 ELSE 0 END) AS Pending,
        SUM(CASE WHEN ms.StatusName = 'Approved'  THEN 1 ELSE 0 END) AS Approved,
        SUM(CASE WHEN ms.StatusName = 'Active'    THEN 1 ELSE 0 END) AS Active,
        SUM(CASE WHEN ms.StatusName = 'Inactive'  THEN 1 ELSE 0 END) AS Inactive,
        SUM(CASE WHEN ms.StatusName = 'Suspended' THEN 1 ELSE 0 END) AS Suspended,
        SUM(CASE WHEN ms.StatusName = 'Rejected'  THEN 1 ELSE 0 END) AS Rejected,
        SUM(CASE WHEN m.ApprovedDate >= @FromDate
                  AND  m.ApprovedDate <  DATEADD(DAY, 1, @ToDate) THEN 1 ELSE 0 END) AS NewThisPeriod
    FROM   dbo.Member m
           JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId
    WHERE  m.ChapterId = @ChapterId
      AND  m.IsDeleted = 0;

    /* ---------- 3. Activity — headcount first, percentage never alone ----------
       TotalOnSheets is rows actually present on each meeting's OWN attendance sheet
       (any status), NOT the chapter's current roster size — a member who joined in
       June was never "absent" from a March meeting he didn't yet belong to. */
    ;WITH RangeMeetings AS (
        SELECT MeetingId
        FROM   dbo.Meeting
        WHERE  ChapterId   = @ChapterId
          AND  IsFinalized = 1
          AND  MeetingDate BETWEEN @FromDate AND @ToDate
    )
    SELECT
        (SELECT COUNT(*) FROM RangeMeetings) AS MeetingsHeld,
        ISNULL((SELECT COUNT(*)
                FROM   dbo.MeetingAttendance ma
                       JOIN dbo.AttendanceStatus s ON s.AttendanceStatusId = ma.AttendanceStatusId
                       JOIN RangeMeetings rm ON rm.MeetingId = ma.MeetingId
                WHERE  s.StatusName = 'Present'), 0) AS TotalPresent,
        ISNULL((SELECT COUNT(*)
                FROM   dbo.MeetingAttendance ma
                       JOIN RangeMeetings rm ON rm.MeetingId = ma.MeetingId), 0) AS TotalOnSheets,
        ISNULL(
            CAST(
                ISNULL((SELECT COUNT(*)
                         FROM   dbo.MeetingAttendance ma
                                JOIN dbo.AttendanceStatus s ON s.AttendanceStatusId = ma.AttendanceStatusId
                                JOIN RangeMeetings rm ON rm.MeetingId = ma.MeetingId
                         WHERE  s.StatusName = 'Present'), 0)
                AS DECIMAL(18,2)
            ) / NULLIF((SELECT COUNT(*) FROM RangeMeetings), 0)
        , 0) AS AveragePresentPerMeeting;

    /* ---------- 4. Corrective actions — counts by status only ----------
       One row per canonical status (CK_CorrectiveAction_Status: Pending, Under Review,
       Reconciled, Dismissed), zero-filled when a chapter has no cases in a status for
       the range — never a case list, never a member name. */
    SELECT
        v.StatusName,
        ISNULL(cnt.Cnt, 0) AS CaseCount
    FROM (VALUES ('Pending'), ('Under Review'), ('Reconciled'), ('Dismissed')) AS v(StatusName)
        OUTER APPLY (
            SELECT COUNT(*) AS Cnt
            FROM   dbo.CorrectiveAction ca
            WHERE  ca.ChapterId  = @ChapterId
              AND  ca.StatusName = v.StatusName
              AND  ca.DateFiled BETWEEN @FromDate AND @ToDate
        ) cnt
    ORDER BY v.StatusName;
END
GO
