/* The only place a failed sign-in is recorded — the generic audit interceptor sees
   a successful write, not a rejected credential, so it cannot cover this by itself.
   Both outcomes are audited. Lockout: 5 failed attempts, 15 minutes. */
CREATE OR ALTER PROCEDURE dbo.usp_Auth_RecordSignInResult
    @AccountId INT,
    @Success   BIT,
    @Ip        NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @MemberId INT;
    SELECT @MemberId = MemberId FROM dbo.UserAccount WHERE AccountId = @AccountId;

    IF @MemberId IS NULL
        THROW 51120, 'Account not found.', 1;

    BEGIN TRAN;
        IF @Success = 1
        BEGIN
            UPDATE dbo.UserAccount
               SET FailedAttempts = 0, LockedUntil = NULL
             WHERE AccountId = @AccountId;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], PerformedBy, IpAddress)
            VALUES ('UserAccount', CAST(@AccountId AS NVARCHAR(40)), 'SignInSucceeded', @MemberId, @Ip);
        END
        ELSE
        BEGIN
            UPDATE dbo.UserAccount
               SET FailedAttempts = FailedAttempts + 1
             WHERE AccountId = @AccountId;

            DECLARE @NewAttempts INT;
            SELECT @NewAttempts = FailedAttempts FROM dbo.UserAccount WHERE AccountId = @AccountId;

            IF @NewAttempts >= 5
                UPDATE dbo.UserAccount
                   SET LockedUntil = DATEADD(MINUTE, 15, SYSUTCDATETIME())
                 WHERE AccountId = @AccountId;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
            VALUES ('UserAccount', CAST(@AccountId AS NVARCHAR(40)), 'SignInFailed',
                    CONCAT(N'{"FailedAttempts":', @NewAttempts, N'}'), @MemberId, @Ip);
        END
    COMMIT;
END
GO
