/* Revokes every live refresh token for an account: used on sign-out, and by
   usp_RefreshToken_Rotate when it detects reuse of an already-spent token. */
CREATE OR ALTER PROCEDURE dbo.usp_RefreshToken_RevokeFamily
    @AccountId INT,
    @Reason    NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
        UPDATE dbo.RefreshToken
           SET RevokedOn = SYSUTCDATETIME(), RevokedReason = @Reason
         WHERE AccountId = @AccountId AND RevokedOn IS NULL;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('RefreshToken', CAST(@AccountId AS NVARCHAR(40)), 'RevokeFamily',
                CONCAT(N'{"Reason":"', @Reason, N'"}'), NULL);
    COMMIT;
END
GO
