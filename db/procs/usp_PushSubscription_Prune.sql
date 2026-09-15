/* INTERNAL MAINTENANCE ONLY — do not expose this as a public/user-reachable endpoint.
   Called exclusively by the backend's push-sending worker when the push SERVICE
   itself answers 404 or 410 for a subscription (the browser unsubscribed, cleared
   site data, or the OS revoked it — the endpoint is provably dead). There is
   deliberately NO ownership/membership check here: by the time this runs, the caller
   is trusted system code reacting to an external service's response, not a user
   request, so there is no @AccountId/@RequestingMemberId to check against. If this
   proc is ever wired to an HTTP route reachable by a client, that is a bug — add the
   ownership check usp_PushSubscription_Remove already has, or call that proc instead.

   Hard DELETE — explicitly permitted for dbo.PushSubscription; see that table's
   header comment in db/schema/15_chat_private.sql. No AuditLog write: this is routine
   system housekeeping of ephemeral device state with no human actor behind it, not an
   organizational fact worth a permanent record. @Reason is accepted for the caller's
   own logging/telemetry and is not persisted anywhere by this proc. */
CREATE OR ALTER PROCEDURE dbo.usp_PushSubscription_Prune
    @SubscriptionId INT,
    @Reason NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DELETE dbo.PushSubscription WHERE SubscriptionId = @SubscriptionId;
END
GO
