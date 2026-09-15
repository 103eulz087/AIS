/* INTERNAL USE ONLY — called by the backend's push-sending worker to find where to
   deliver a notification for a given member, never by a user-reachable endpoint (there
   is no reason a client would ever need to list its own raw P256dh/AuthSecret keys
   back out). dbo.UserAccount.MemberId is UNIQUE (db/schema/07_auth.sql), so a member
   has at most one account and this join can return more than one row only because a
   member can have several devices (several dbo.PushSubscription rows), never several
   accounts.

   Skips any account with IsDisabled = 1 — a disabled account should not still be
   pushed to, even if its old subscriptions are technically still registered. */
CREATE OR ALTER PROCEDURE dbo.usp_PushSubscription_GetForMember
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT  ps.SubscriptionId, ps.AccountId, ps.Endpoint, ps.P256dh, ps.AuthSecret,
            ps.DeviceHint, ps.CreatedOn, ps.LastSuccessOn, ps.FailureCount
    FROM    dbo.PushSubscription ps
            JOIN dbo.UserAccount ua ON ua.AccountId = ps.AccountId
    WHERE   ua.MemberId = @MemberId
      AND   ua.IsDisabled = 0;
END
GO
