/* Reads the caller's OWN account hash so the API layer can verify his current password
   before accepting a new one (verification itself needs Akrho.Infrastructure.Security.
   IPasswordHasherService — PBKDF2 comparison — which only exists in C#, never in T-SQL).

   NO @MemberId PARAMETER. Self-only by construction, same reasoning as
   usp_Member_GetOwnProfile — there is no id here for a caller to substitute to read
   someone else's password hash. */
CREATE OR ALTER PROCEDURE dbo.usp_Auth_GetOwnAccountForPasswordChange
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT ua.AccountId, ua.PasswordHash
    FROM   dbo.UserAccount ua
           JOIN dbo.Member m ON m.MemberId = ua.MemberId AND m.IsDeleted = 0
    WHERE  ua.MemberId = @RequestingMemberId;
END
GO
