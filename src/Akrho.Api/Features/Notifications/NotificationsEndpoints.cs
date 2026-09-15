using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Notifications;

/// <summary>
/// Web Push subscription management and per-member notification preferences. Every route here
/// is self-scoped — a subscription belongs to the caller's own account (ICurrentUser.AccountId),
/// a preference to the caller's own member id (ICurrentUser.MemberId) — never a chapter, so
/// there is no IScopeGuard call anywhere in this file, same posture as Features/Conversations.
/// </summary>
public static class NotificationsEndpoints
{
    public static IEndpointRouteBuilder MapNotifications(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/notifications").WithTags("Notifications").RequireAuthorization();

        g.MapGet("/vapid-key", GetVapidKey).WithName("GetVapidPublicKey");

        g.MapPost("/subscriptions", RegisterSubscription).WithName("RegisterPushSubscription");
        g.MapDelete("/subscriptions/{subscriptionId:int}", RemoveSubscription).WithName("RemovePushSubscription");

        g.MapGet("/preferences", GetPreferences).WithName("GetNotificationPreferences");
        g.MapPut("/preferences", SetPreferences).WithName("SetNotificationPreferences");

        return app;
    }

    private static Ok<VapidPublicKeyDto> GetVapidKey(IConfiguration configuration) =>
        TypedResults.Ok(new VapidPublicKeyDto(configuration["Push:VapidPublicKey"] ?? string.Empty));

    private static async Task<Results<Ok<PushSubscriptionRegisteredDto>, ValidationProblem>> RegisterSubscription(
        RegisterPushSubscriptionRequest req, IPushRepository repo, ICurrentUser caller,
        IValidator<RegisterPushSubscriptionRequest> validator, HttpContext http, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var subscriptionId = await repo.RegisterSubscriptionAsync(
            caller.AccountId, req.Endpoint, req.P256dh, req.AuthSecret, req.DeviceHint,
            http.Connection.RemoteIpAddress?.ToString(), ct);

        return TypedResults.Ok(new PushSubscriptionRegisteredDto(subscriptionId));
    }

    private static async Task<Results<Ok, NotFound>> RemoveSubscription(
        int subscriptionId, IPushRepository repo, ICurrentUser caller, HttpContext http, CancellationToken ct)
    {
        try
        {
            await repo.RemoveSubscriptionAsync(
                caller.AccountId, subscriptionId, http.Connection.RemoteIpAddress?.ToString(), ct);
            return TypedResults.Ok();
        }
        catch (ChatException)
        {
            // usp_PushSubscription_Remove's only failure (51285) is the merged
            // anti-enumeration check — a nonexistent subscription id and one that belongs to a
            // different account both come back the same way.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Ok<NotificationPreferenceDto>> GetPreferences(
        IPushRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        var row = await repo.GetNotificationPreferenceAsync(caller.MemberId, ct);
        return TypedResults.Ok(new NotificationPreferenceDto(row.PrivateMessagePush, row.MentionPush));
    }

    private static async Task<Ok> SetPreferences(
        SetNotificationPreferenceRequest req, IPushRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        await repo.SetNotificationPreferenceAsync(caller.MemberId, req.PrivateMessagePush, req.MentionPush, ct);
        return TypedResults.Ok();
    }
}
