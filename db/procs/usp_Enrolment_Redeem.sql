/* The officer sets his own password. One transaction: validate the link, write the
   credential, mark the link redeemed, audit it — or none of it. There is no path
   here that creates a Member row; redemption fails outright if the member doesn't
   exist (CLAUDE.md §2 invariant 13 / decision 20). */
CREATE OR ALTER PROCEDURE dbo.usp_Enrolment_Redeem
    @TokenHash    VARBINARY(32),
    @PasswordHash NVARCHAR(200),
    @Ip           NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @LinkId INT, @MemberId INT;

    SELECT @LinkId = LinkId, @MemberId = MemberId
    FROM   dbo.EnrolmentLink
    WHERE  TokenHash = @TokenHash
      AND  RedeemedOn IS NULL
      AND  InvalidatedOn IS NULL
      AND  ExpiresOn > SYSUTCDATETIME();

    IF @LinkId IS NULL
        THROW 51110, 'This enrolment link is no longer valid. Ask your chapter for a new one.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51111, 'Member not found. An account cannot be created for a member that does not exist.', 1;

    DECLARE @AccountId INT;

    BEGIN TRAN;
        SELECT @AccountId = AccountId FROM dbo.UserAccount WHERE MemberId = @MemberId;

        IF @AccountId IS NULL
        BEGIN
            INSERT dbo.UserAccount (MemberId, PasswordHash, PasswordUpdatedOn)
            VALUES (@MemberId, @PasswordHash, SYSUTCDATETIME());

            SET @AccountId = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            /* Officer turnover, or a re-enrolment: reissue the credential on the
               same account row rather than creating a second one for the same member. */
            UPDATE dbo.UserAccount
               SET PasswordHash      = @PasswordHash,
                   PasswordUpdatedOn = SYSUTCDATETIME(),
                   FailedAttempts    = 0,
                   LockedUntil       = NULL,
                   IsDisabled        = 0
             WHERE AccountId = @AccountId;
        END

        UPDATE dbo.EnrolmentLink
           SET RedeemedOn = SYSUTCDATETIME()
         WHERE LinkId = @LinkId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
        VALUES ('UserAccount', CAST(@AccountId AS NVARCHAR(40)), 'EnrolmentRedeemed',
                CONCAT(N'{"MemberId":', @MemberId, N',"LinkId":', @LinkId, N'}'),
                @MemberId, @Ip);
    COMMIT;

    SELECT @AccountId AS AccountId, @MemberId AS MemberId;
END
GO
