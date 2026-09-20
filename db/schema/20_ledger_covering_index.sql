/* 20 — Covering index for dbo.LedgerEntry, added for the Council Statistics module
   (db/procs/usp_CouncilStatistics_Get.sql).

   db/schema/03_meetings_money.sql's IX_Ledger_Chapter_Date is ON (ChapterId, EntryDate DESC)
   with NO included columns. usp_Dashboard_GetChapterSummary.sql only ever sums ONE
   chapter's ledger per call, so a key lookup per matching row was cheap enough never to
   matter. usp_CouncilStatistics_Get.sql's Set 3 now sums EVERY chapter's ledger in a
   council's subtree in a single call — for a National focus, that is every chapter in the
   national register (~1,100 at the docs' own projected scale, per
   db/schema/17_chapter_registration.sql's ChapterSeq sizing note) each doing its own
   OpeningBalance/PeriodIn/PeriodOut scan. That is exactly the shape CLAUDE.md §"Performance"
   warns about: "the national register has tens of thousands [of members]... write for the
   second number, not the first."

   The financial OUTER APPLY in usp_CouncilStatistics_Get needs EntryType and Amount for
   every row it touches. Neither is in the existing index's key or its (nonexistent)
   INCLUDE list, so the existing index can only narrow the row set by (ChapterId, EntryDate)
   and then pay a key lookup back to the clustered index for EntryType/Amount on every row
   that survives — once per chapter, at national scale. Adding those two columns to the
   INCLUDE list turns the same index fully covering for both this proc's aggregation and
   usp_Dashboard_GetChapterSummary's existing one: no plan-shape change for the latter, and
   no key lookup at all for either, going forward.

   NOTE ON VERIFICATION: this change is justified by the query shape itself (SARGable
   predicate on (ChapterId, EntryDate), output needs EntryType + Amount for every row) and
   is safe/additive — it cannot change any existing query's results, only remove key
   lookups from its plan. It was NOT captured against a live actual execution plan, because
   this session had no working credential to reach the shared dev/test SQL Server
   (corex.itcoreapps.com,6601 / AISDB) to run one. Before/after confirmation the human
   operator can run once deployed:

       SET STATISTICS IO ON;
       EXEC dbo.usp_CouncilStatistics_Get @RequestingMemberId = <a seated council officer's MemberId>,
                                           @FromDate = '2020-01-01', @ToDate = '2026-12-31';
       -- "Key Lookup" operators against LedgerEntry's clustered index, or a high
       -- "logical reads" count against LedgerEntry in the IO stats, before this file
       -- is deployed, should disappear (or drop sharply) after.

   Idempotent: safe to re-run — the IF NOT EXISTS guard checks whether the index already
   carries Amount as an included column; if it does, this file is a no-op. */

IF EXISTS (
    SELECT 1 FROM sys.indexes i
    WHERE  i.name = 'IX_Ledger_Chapter_Date' AND i.object_id = OBJECT_ID('dbo.LedgerEntry')
)
AND NOT EXISTS (
    SELECT 1
    FROM   sys.index_columns ic
           JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE  ic.object_id = OBJECT_ID('dbo.LedgerEntry')
      AND  ic.index_id  = (SELECT index_id FROM sys.indexes
                            WHERE name = 'IX_Ledger_Chapter_Date' AND object_id = OBJECT_ID('dbo.LedgerEntry'))
      AND  ic.is_included_column = 1
      AND  col.name = 'Amount'
)
BEGIN
    DROP INDEX IX_Ledger_Chapter_Date ON dbo.LedgerEntry;
    CREATE INDEX IX_Ledger_Chapter_Date
        ON dbo.LedgerEntry(ChapterId, EntryDate DESC)
        INCLUDE (EntryType, Amount);
END
GO

/* ---- The other indexes CLAUDE.md's Performance section names, CONFIRMED already in
   place — listed here so a future reader of this file does not re-add them, and so this
   file's own header claim ("add ONLY what the plan demands") is checked against something
   concrete rather than asserted. No DDL follows for any of these; this is a record of
   what was checked, not an action list.

     dbo.Member(ChapterId, StatusId)              IX_Member_Chapter_Status        (02_members.sql)
     dbo.Member(BloodTypeId)                      IX_Member_BloodType             (02_members.sql)
     dbo.MemberSkill(SkillId)                     IX_MemberSkill_Skill            (02_members.sql)
     dbo.MemberRole(MemberId, ScopeType, ScopeId) IX_MemberRole_Member            (02_members.sql)
     dbo.Chapter(ParentCouncilId)                 IX_Chapter_Council              (01_organization.sql)
     dbo.Council(ParentCouncilId)                 IX_Council_Parent               (01_organization.sql)
     dbo.CorrectiveAction(ChapterId, DateFiled)   IX_CorrectiveAction_Chapter_Filed (12_corrective_actions.sql)
     dbo.Meeting(ChapterId, MeetingDate DESC)     IX_Meeting_Chapter_Date         (03_meetings_money.sql)
     dbo.MeetingAttendance(MeetingId)             IX_Attendance_Meeting           (03_meetings_money.sql)
     dbo.ChapterRenewal(PeriodId, StatusName)     IX_Renewal_Period_Status        (05_identity_renewal.sql)

   Every one of these is exactly what usp_CouncilStatistics_Get's own subtree-scoped joins
   (Chapter by ParentCouncilId, Council by ParentCouncilId for the recursive walk, Member by
   ChapterId+StatusId, CorrectiveAction/Meeting by ChapterId+date) need — no gap found for
   any of them, so nothing is added here. */
