/* Looks up the account behind a sign-in identifier — either the member number or the
   mobile number on file (a member's mobile is meant to double as an easier-to-remember
   username; usp_ChapterRegistration_Approve/usp_MembershipApplication_Approve/
   usp_Member_UpdateOwnProfile all now trap a mobile number already in use by another
   member, so this match can never resolve to more than one account). No 2FA columns —
   this slice is password-only by decision; see the header comment on dbo.UserAccount in
   db/schema/07_auth.sql.

   IsChapterOnHold (23_chapter_hold.sql): a detached member (invariant #14 — ChapterId
   NULL) has no chapter to be held, so the LEFT JOIN plus explicit BIT cast reads him as
   never-on-hold rather than NULL — a bare CASE WHEN here would infer INT, not BIT, and
   break Dapper's constructor match the same way CLAUDE.md's own §8.7 gotcha describes;
   cast explicitly, same as every other BIT column in this proc's neighbourhood. */
CREATE OR ALTER PROCEDURE dbo.usp_Auth_GetAccountForSignIn
    @Identifier NVARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    -- TOP (1), deterministically ordered: MobileNo has no database-level UNIQUE constraint
    -- yet (dry-run phase — see usp_Member_UpdateOwnProfile's own header comment on why),
    -- so a pre-existing duplicate must never make this throw instead of picking one
    -- account. MemberNumber alone is DB-enforced unique (02_members.sql), so this only
    -- ever matters for the mobile-number match.
    SELECT TOP (1) ua.AccountId, ua.PasswordHash, ua.FailedAttempts, ua.LockedUntil, ua.IsDisabled,
           m.MemberId, m.ChapterId,
           CAST(CASE WHEN ch.IsOnHold = 1 THEN 1 ELSE 0 END AS BIT) AS IsChapterOnHold
    FROM   dbo.UserAccount ua
           JOIN dbo.Member m ON m.MemberId = ua.MemberId
           LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
    WHERE  (m.MemberNumber = @Identifier OR m.MobileNo = @Identifier)
      AND  m.IsDeleted = 0
    ORDER BY m.MemberId;
END
GO
