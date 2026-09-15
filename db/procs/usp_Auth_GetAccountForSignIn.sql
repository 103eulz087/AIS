/* Looks up the account behind a member number for sign-in. No 2FA columns —
   this slice is password-only by decision; see the header comment on
   dbo.UserAccount in db/schema/07_auth.sql. */
CREATE OR ALTER PROCEDURE dbo.usp_Auth_GetAccountForSignIn
    @MemberNumber NVARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT ua.AccountId, ua.PasswordHash, ua.FailedAttempts, ua.LockedUntil, ua.IsDisabled,
           m.MemberId, m.ChapterId
    FROM   dbo.UserAccount ua
           JOIN dbo.Member m ON m.MemberId = ua.MemberId
    WHERE  m.MemberNumber = @MemberNumber
      AND  m.IsDeleted = 0;
END
GO
