/* Registers (or re-registers) a Web Push subscription for an account — called by the
   frontend once the browser/device grants push permission and returns an endpoint +
   keys. Upserts on Endpoint (dbo.PushSubscription's UNIQUE constraint,
   db/schema/15_chat_private.sql): the same browser subscribing again (e.g. the
   service worker re-registering after an update) updates the existing row in place
   rather than creating a duplicate. FailureCount is reset to 0 on every successful
   (re-)registration — the device confirming its endpoint again is itself evidence
   the endpoint is alive, which is exactly what FailureCount tracks the absence of.

   Race safety: two (re-)registrations of the SAME endpoint arriving at the same
   instant could both find no row to UPDATE and both attempt the INSERT; Endpoint's
   unique constraint is what makes this safe — the loser's INSERT hits a duplicate-key
   violation, caught and folded back into the UPDATE, same "unique-violation is not an
   error" shape as usp_ChatRoom_EnsurePublic.

   Audit: NewValues carries AccountId and a SHA2_256 hash of the endpoint — NEVER the
   endpoint itself. The endpoint is effectively a bearer credential for pushing to that
   device; writing it in cleartext into AuditLog (permanent, broadly readable by
   design) would leak it far beyond where it needs to live. PerformedBy is resolved
   from the account's own MemberId (there is no separate MemberId parameter here —
   this proc only knows the account), so the audit trail still attributes the action
   to a person, not just an anonymous account id. */
CREATE OR ALTER PROCEDURE dbo.usp_PushSubscription_Register
    @AccountId INT,
    @Endpoint NVARCHAR(500),
    @P256dh NVARCHAR(200),
    @AuthSecret NVARCHAR(100),
    @DeviceHint NVARCHAR(120) = NULL,
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @MemberId INT = (SELECT MemberId FROM dbo.UserAccount WHERE AccountId = @AccountId);
    DECLARE @EndpointHash NVARCHAR(64) = CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', @Endpoint), 2);
    DECLARE @SubscriptionId INT;

    BEGIN TRY
        BEGIN TRAN;
            UPDATE dbo.PushSubscription
            SET    AccountId = @AccountId, P256dh = @P256dh, AuthSecret = @AuthSecret,
                   DeviceHint = @DeviceHint, FailureCount = 0
            WHERE  Endpoint = @Endpoint;

            IF @@ROWCOUNT = 0
            BEGIN
                INSERT dbo.PushSubscription (AccountId, Endpoint, P256dh, AuthSecret, DeviceHint)
                VALUES (@AccountId, @Endpoint, @P256dh, @AuthSecret, @DeviceHint);

                SET @SubscriptionId = SCOPE_IDENTITY();
            END
            ELSE
                SELECT @SubscriptionId = SubscriptionId FROM dbo.PushSubscription WHERE Endpoint = @Endpoint;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
            VALUES ('PushSubscription', CAST(@SubscriptionId AS NVARCHAR(40)), 'Register',
                    CONCAT(N'{"AccountId":', @AccountId, N',"EndpointHash":"', @EndpointHash, N'"}'),
                    @MemberId, @Ip);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;

        IF ERROR_NUMBER() IN (2601, 2627)
        BEGIN
            -- Concurrent registration of the same endpoint won the race. Apply our
            -- values on top (last writer wins on the keys/hint) and still audit.
            UPDATE dbo.PushSubscription
            SET    AccountId = @AccountId, P256dh = @P256dh, AuthSecret = @AuthSecret,
                   DeviceHint = @DeviceHint, FailureCount = 0
            WHERE  Endpoint = @Endpoint;

            SELECT @SubscriptionId = SubscriptionId FROM dbo.PushSubscription WHERE Endpoint = @Endpoint;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
            VALUES ('PushSubscription', CAST(@SubscriptionId AS NVARCHAR(40)), 'Register',
                    CONCAT(N'{"AccountId":', @AccountId, N',"EndpointHash":"', @EndpointHash, N'"}'),
                    @MemberId, @Ip);
        END
        ELSE
            THROW;
    END CATCH

    SELECT @SubscriptionId AS SubscriptionId;
END
GO
