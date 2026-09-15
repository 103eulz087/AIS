/* Refresh tokens rotate on every use and are single-use. Presenting a token that is
   already revoked or already rotated can only mean replay — a stolen or duplicated
   token — so the whole account's live tokens are torn down and the caller is forced
   back through a full sign-in. A merely expired (never-used) token is just expired:
   no compromise, no family revocation, just a normal re-login.

   Returns AccountId/MemberId/ChapterId alongside the new TokenId: the access token is
   minted purely from the httpOnly refresh cookie (the SPA holds no access token across
   a page reload — see api.ts), so the caller has no other way to learn whose token this
   is. These are row ids, not personal data — same category as the "mid"/"chp" claims
   already minted into every access token. */
CREATE OR ALTER PROCEDURE dbo.usp_RefreshToken_Rotate
    @OldTokenHash VARBINARY(32),
    @NewTokenHash VARBINARY(32),
    @ExpiresOn    DATETIME2,
    @DeviceHint   NVARCHAR(120) = NULL,
    @Ip           NVARCHAR(45)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @OldTokenId INT, @AccountId INT, @OldExpiresOn DATETIME2,
            @OldRevokedOn DATETIME2, @OldRotatedTo INT;

    SELECT @OldTokenId   = TokenId,
           @AccountId    = AccountId,
           @OldExpiresOn = ExpiresOn,
           @OldRevokedOn = RevokedOn,
           @OldRotatedTo = RotatedToTokenId
    FROM   dbo.RefreshToken
    WHERE  TokenHash = @OldTokenHash;

    IF @OldTokenId IS NULL
        THROW 51140, 'Refresh token not recognised. Sign in again.', 1;

    IF @OldRevokedOn IS NOT NULL OR @OldRotatedTo IS NOT NULL
    BEGIN
        UPDATE dbo.RefreshToken
           SET RevokedOn = SYSUTCDATETIME(), RevokedReason = 'reuse detected'
         WHERE AccountId = @AccountId AND RevokedOn IS NULL;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
        VALUES ('RefreshToken', CAST(@OldTokenId AS NVARCHAR(40)), 'ReuseDetected',
                N'{"Reason":"reuse detected"}', NULL, @Ip);

        THROW 51141, 'This refresh token has already been used. All sessions on this account have been signed out — sign in again.', 1;
    END

    IF @OldExpiresOn <= SYSUTCDATETIME()
        THROW 51142, 'Refresh token has expired. Sign in again.', 1;

    DECLARE @NewTokenId INT;

    BEGIN TRAN;
        INSERT dbo.RefreshToken (AccountId, TokenHash, ExpiresOn, DeviceHint, IpAddress)
        VALUES (@AccountId, @NewTokenHash, @ExpiresOn, @DeviceHint, @Ip);

        SET @NewTokenId = SCOPE_IDENTITY();

        UPDATE dbo.RefreshToken
           SET RotatedToTokenId = @NewTokenId,
               RevokedOn        = SYSUTCDATETIME(),
               RevokedReason    = 'rotated'
         WHERE TokenId = @OldTokenId;
    COMMIT;

    SELECT rt.TokenId, ua.AccountId, ua.MemberId, m.ChapterId
    FROM   dbo.RefreshToken rt
           JOIN dbo.UserAccount ua ON ua.AccountId = rt.AccountId
           JOIN dbo.Member m ON m.MemberId = ua.MemberId
    WHERE  rt.TokenId = @NewTokenId;
END
GO
