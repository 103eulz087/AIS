namespace Akrho.Api.Features.Notifications;

/// <summary>
/// GET /api/notifications/vapid-key result. The VAPID PUBLIC key is not a secret — a browser
/// needs it client-side to call pushManager.subscribe(). Never the private key.
/// </summary>
public sealed record VapidPublicKeyDto(string PublicKey);

/// <summary>
/// POST /api/notifications/subscriptions body — exactly what the browser's own
/// PushManager.subscribe() returns, forwarded as-is. No accountId/memberId here — the caller's
/// own identity comes from ICurrentUser.AccountId alone.
/// </summary>
public sealed record RegisterPushSubscriptionRequest(
    string Endpoint, string P256dh, string AuthSecret, string? DeviceHint = null);

public sealed record PushSubscriptionRegisteredDto(int SubscriptionId);

/// <summary>GET/PUT /api/notifications/preferences — the caller's own notification preferences.</summary>
public sealed record NotificationPreferenceDto(bool PrivateMessagePush, bool MentionPush);

public sealed record SetNotificationPreferenceRequest(bool PrivateMessagePush, bool MentionPush);
