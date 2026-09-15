using System.Net;
using System.Text.Json;
using Akrho.Infrastructure.Repositories;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.Extensions.Configuration;

namespace Akrho.Infrastructure.Push;

/// <summary>
/// Wraps Lib.Net.Http.WebPush's <see cref="PushServiceClient"/>. VAPID keys come from
/// configuration ("Push:VapidPublicKey"/"Push:VapidPrivateKey"/"Push:VapidSubject") the same
/// way Jwt:SigningKey is read in Program.cs — a DEV-ONLY placeholder ships in
/// appsettings.json, and devops provisions the real pair outside source control.
///
/// Registered as a singleton (see Program.cs) — <see cref="PushServiceClient"/> owns an
/// <see cref="HttpClient"/> internally and is intended to be reused, not constructed per call;
/// disposed once at shutdown via <see cref="IDisposable"/>.
/// </summary>
public sealed class PushSender : IPushSender, IDisposable
{
    private readonly PushServiceClient _client = new();

    public PushSender(IConfiguration configuration)
    {
        var publicKey = configuration["Push:VapidPublicKey"]
            ?? throw new InvalidOperationException("Push:VapidPublicKey is not configured.");
        var privateKey = configuration["Push:VapidPrivateKey"]
            ?? throw new InvalidOperationException("Push:VapidPrivateKey is not configured.");
        var subject = configuration["Push:VapidSubject"]
            ?? throw new InvalidOperationException("Push:VapidSubject is not configured.");

        _client.DefaultAuthentication = new VapidAuthentication(publicKey, privateKey)
        {
            Subject = subject
        };
    }

    public async Task SendAsync(
        PushSubscriptionRow subscription, string title, string body, object data, CancellationToken ct)
    {
        var pushSubscription = new PushSubscription { Endpoint = subscription.Endpoint };
        pushSubscription.SetKey(PushEncryptionKeyName.P256DH, subscription.P256dh);
        pushSubscription.SetKey(PushEncryptionKeyName.Auth, subscription.AuthSecret);

        // Fixed shape, no free-text interpolation beyond what the caller already assembled
        // into title/body (a gift name only — see PushDispatchHostedService's own templates).
        // This method has no idea what a "message body" even is; it cannot leak one it was
        // never given.
        var payload = JsonSerializer.Serialize(new { title, body, data });
        var pushMessage = new PushMessage(payload);

        try
        {
            await _client.RequestPushMessageDeliveryAsync(pushSubscription, pushMessage, ct);
        }
        catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            throw new PushSubscriptionGoneException(subscription.SubscriptionId, ex);
        }
    }

    public void Dispose() => _client.DefaultAuthentication?.Dispose();
}
