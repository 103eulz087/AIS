/* Removes ("unsubscribes") a push subscription at the owning account's own request
   (e.g. the member turning off notifications for this device in settings) — distinct
   from usp_PushSubscription_Prune, which is the push-sending worker's own cleanup of
   a subscription the push SERVICE has rejected.

   Anti-enumeration (51285): a SubscriptionId that doesn't exist and one that exists
   but belongs to a DIFFERENT account both come back as the same generic "not found" —
   this endpoint cannot be used to probe whether a given subscription id exists
   somewhere the caller doesn't own.

   This IS a hard DELETE — explicitly permitted for dbo.PushSubscription (ephemeral
   device state, not an organizational record; see that table's header comment in
   db/schema/15_chat_private.sql). Audited the same way as Register: NewValues carries
   AccountId and a SHA2_256 hash of the endpoint, never the endpoint itself. */
CREATE OR ALTER PROCEDURE dbo.usp_PushSubscription_Remove
    @AccountId INT,
    @SubscriptionId INT,
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Endpoint NVARCHAR(500);
    SELECT @Endpoint = Endpoint FROM dbo.PushSubscription WHERE SubscriptionId = @SubscriptionId AND AccountId = @AccountId;

    IF @Endpoint IS NULL
        THROW 51285, 'Push subscription not found.', 1;

    DECLARE @MemberId INT = (SELECT MemberId FROM dbo.UserAccount WHERE AccountId = @AccountId);
    DECLARE @EndpointHash NVARCHAR(64) = CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', @Endpoint), 2);

    BEGIN TRAN;
        DELETE dbo.PushSubscription WHERE SubscriptionId = @SubscriptionId AND AccountId = @AccountId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
        VALUES ('PushSubscription', CAST(@SubscriptionId AS NVARCHAR(40)), 'Remove',
                CONCAT(N'{"AccountId":', @AccountId, N',"EndpointHash":"', @EndpointHash, N'"}'),
                @MemberId, @Ip);
    COMMIT;
END
GO
