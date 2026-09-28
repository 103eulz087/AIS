/* One-time administrative correction, 2026-09-23.

   Chapter 134 ("Upsilon Xi", chartered 9/18/2026) was a duplicate registration: the
   same 8 people registered their chapter again the next day as Chapter 151 (also
   "Upsilon Xi", chartered 9/19/2026) with corrected full names — three officers'
   mobile numbers matched exactly between the two registrations. Chapter 151 is the
   real, ongoing chapter; 134 was the rough/dummy first attempt.

   Verified before writing this script — nothing beyond initial-charter activity exists
   under Chapter 134 or its 8 members:
     Meetings=0, LedgerEntry=0, Expense=0, Donation=0, CorrectiveAction=0,
     ChatMessage=0, MembershipApplication=0, ChapterRegistration submitted=0,
     MemberAccountAction=0, SeconderMemberId references=0.
   The only real activity: MemberId 754 (the President) redeemed his enrolment link
   and signed in a handful of times on 9/18-9/19 while testing the flow, and had a
   digital ID credential issued. No organizational activity (no meeting, no money, no
   discipline, no chat) ever happened under this chapter.

   NEVER a hard DELETE — CLAUDE.md invariant #15 ("councils and chapters are never
   deleted") and dbo.Member's own IsDeleted flag is the established soft-delete
   convention used everywhere else in this codebase. This retires the chapter and its
   8 members exactly the way any other retirement would: deactivate, don't erase.
   Every row — and this script — stays as the permanent record of why.

   Run once, idempotent (each UPDATE/EXEC is a no-op the second time; the AuditLog
   inserts are the only non-idempotent part, deliberately left that way since a repeat
   run isn't expected). */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @PerformedBy INT = 1;   -- TANGLAW, National Council
DECLARE @Reason NVARCHAR(300) = N'Duplicate chapter registration -- same 8 officers re-registered a day later as Chapter 151 with corrected names. Chapter 134 was the dummy/test attempt; no real chapter activity (no meetings/expenses/donations/corrective actions/chat) occurred under it.';

BEGIN TRAN;
    UPDATE dbo.Chapter SET IsActive = 0 WHERE ChapterId = 134;

    UPDATE dbo.Member SET IsDeleted = 1
    WHERE ChapterId = 134 AND MemberId IN (754, 755, 756, 757, 758, 759, 760, 761);

    -- The one live testing account under this chapter (AccountId 18, MemberId 754) —
    -- cut it the same way usp_Member_Block/usp_Chapter_Hold already cut a real one.
    EXEC dbo.usp_RefreshToken_RevokeFamily @AccountId = 18, @Reason = N'Chapter retired as a duplicate registration';

    INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
    VALUES ('Chapter', '134', 'Deactivate', CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @PerformedBy);

    INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
    SELECT 'Member', CAST(MemberId AS NVARCHAR(40)), 'Delete',
           CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @PerformedBy
    FROM   dbo.Member
    WHERE  ChapterId = 134 AND MemberId IN (754, 755, 756, 757, 758, 759, 760, 761);
COMMIT;

-- Verify
SELECT ChapterId, ChapterName, IsActive FROM dbo.Chapter WHERE ChapterId = 134;
SELECT MemberId, MemberNumber, GiftName, IsDeleted FROM dbo.Member WHERE ChapterId = 134 ORDER BY MemberId;
