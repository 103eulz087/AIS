using Akrho.Infrastructure.Repositories;

namespace Akrho.Infrastructure.Push;

/// <summary>
/// Thrown by <see cref="IPushSender"/> when the push SERVICE itself reports a subscription is
/// dead (HTTP 404/410) — the browser unsubscribed, cleared site data, or the OS revoked it. The
/// worker's only response to this is to hard-delete the row via
/// <c>usp_PushSubscription_Prune</c>; every other failure is best-effort and logged.
/// </summary>
public sealed class PushSubscriptionGoneException(int subscriptionId, Exception inner)
    : Exception($"Push subscription {subscriptionId} is no longer valid.", inner)
{
    public int SubscriptionId { get; } = subscriptionId;
}

/// <summary>
/// Sends one Web Push message to one subscription. Deliberately narrow — title/body/data are
/// plain strings/an object the CALLER (PushDispatchHostedService) has already decided on from a
/// fixed template; this interface has no knowledge of chat, rooms, or members at all, so it can
/// never be handed a message body even by mistake.
/// </summary>
public interface IPushSender
{
    Task SendAsync(
        PushSubscriptionRow subscription, string title, string body, object data, CancellationToken ct);
}
