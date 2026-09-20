/* A signed-in member setting his own password — the counterpart to usp_Enrolment_Redeem
   (first-time set) for every time after that. Current-password verification already
   happened in C# (Akrho.Infrastructure.Security.IPasswordHasherService) before this is
   ever called; this proc only ever receives the NEW hash, never a plaintext password
   (CLAUDE.md invariant #16 — passwords are never transmitted, this proc included: only
   the hash crosses into the database, exactly like sign-in/redeem/reissue).

   NO @MemberId PARAMETER other than the caller's own. Self-only by construction, same
   reasoning as usp_Member_UpdateOwnProfile — there is no id here for a caller to
   substitute to change someone else's password.

   Clears FailedAttempts/LockedUntil/IsDisabled the same way usp_Enrolment_Redeem's own
   "reissue the credential" branch does — a member who successfully changes his password
   has just proven he knows the current one, so any stale lockout no longer means anything. */
CREATE OR ALTER PROCEDURE dbo.usp_Auth_ChangePassword
    @RequestingMemberId INT,
    @NewPasswordHash    NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- dbo.UserAccount.MemberId is NOT NULL UNIQUE (07_auth.sql) — at most one account
    -- per member, so this id is stable to read once, before the UPDATE below.
    DECLARE @AccountId INT = (SELECT AccountId FROM dbo.UserAccount WHERE MemberId = @RequestingMemberId);

    IF @AccountId IS NULL
        THROW 51143, 'Account not found.', 1;

    BEGIN TRAN;
        UPDATE dbo.UserAccount
           SET PasswordHash      = @NewPasswordHash,
               PasswordUpdatedOn = SYSUTCDATETIME(),
               FailedAttempts    = 0,
               LockedUntil       = NULL,
               IsDisabled        = 0
         WHERE AccountId = @AccountId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], PerformedBy)
        VALUES ('UserAccount', CAST(@AccountId AS NVARCHAR(40)), 'PasswordChanged', @RequestingMemberId);
    COMMIT;
END
GO
