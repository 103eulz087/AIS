/* Inserts a new refresh token for an active account. The caller generates the raw
   token and hands this proc only its hash — the raw value never reaches the database. */
CREATE OR ALTER PROCEDURE dbo.usp_RefreshToken_Issue
    @AccountId  INT,
    @TokenHash  VARBINARY(32),
    @ExpiresOn  DATETIME2,
    @DeviceHint NVARCHAR(120) = NULL,
    @Ip         NVARCHAR(45)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.UserAccount WHERE AccountId = @AccountId AND IsDisabled = 0)
        THROW 51130, 'Account not found or disabled.', 1;

    INSERT dbo.RefreshToken (AccountId, TokenHash, ExpiresOn, DeviceHint, IpAddress)
    VALUES (@AccountId, @TokenHash, @ExpiresOn, @DeviceHint, @Ip);

    SELECT SCOPE_IDENTITY() AS TokenId;
END
GO
