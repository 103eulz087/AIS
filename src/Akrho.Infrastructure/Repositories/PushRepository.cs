using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>usp_PushSubscription_GetForMember's row shape. INTERNAL — the push-dispatch worker's own use only.</summary>
public sealed record PushSubscriptionRow(
    int SubscriptionId, int AccountId, string Endpoint, string P256dh, string AuthSecret,
    string? DeviceHint, DateTime CreatedOn, DateTime? LastSuccessOn, int FailureCount);

/// <summary>usp_NotificationPreference_Get's row shape — always exactly one row (defaults to true/true).</summary>
public sealed record NotificationPreferenceRow(bool PrivateMessagePush, bool MentionPush);

/// <summary>
/// Push subscriptions and notification preferences. A separate repository from
/// <see cref="IChatRepository"/> — these procedures are keyed off UserAccount/Member, not a
/// chat room, and are shared by both the Public and Private chat modules' push paths — but
/// errors still flow through the SAME <see cref="ChatException"/>/<see cref="ChatErrorCategory"/>
/// type (see that class's own header comment) since usp_PushSubscription_Remove's THROW number
/// (51285) lives in the same 51280-51285 range this session's Private-chat/push work added.
/// </summary>
public interface IPushRepository
{
    /// <summary>
    /// Registers (or re-registers) a Web Push subscription for the caller's own account.
    /// Idempotent on Endpoint — the same browser subscribing again updates the existing row in
    /// place. Never throws a known <see cref="ChatException"/> — this proc always upserts.
    /// </summary>
    Task<int> RegisterSubscriptionAsync(
        int accountId, string endpoint, string p256dh, string authSecret, string? deviceHint,
        string? ip, CancellationToken ct);

    /// <summary>
    /// Removes a subscription at the owning account's own request. Throws
    /// <see cref="ChatException"/> (NotFound — merged anti-enumeration: a nonexistent
    /// subscription id and one that belongs to a different account both come back the same way).
    /// </summary>
    Task RemoveSubscriptionAsync(int accountId, int subscriptionId, string? ip, CancellationToken ct);

    /// <summary>
    /// INTERNAL — the push-dispatch worker's own use only, never a member-facing endpoint (see
    /// usp_PushSubscription_GetForMember's own header comment: there is no reason a client
    /// would ever need its own raw P256dh/AuthSecret keys back).
    /// </summary>
    Task<IReadOnlyList<PushSubscriptionRow>> GetSubscriptionsForMemberAsync(int memberId, CancellationToken ct);

    /// <summary>
    /// INTERNAL MAINTENANCE ONLY — called exclusively by the push-dispatch worker when the push
    /// service itself answers 404/410 for a subscription. Never expose this as a public route
    /// (see usp_PushSubscription_Prune's own header comment).
    /// </summary>
    Task PruneSubscriptionAsync(int subscriptionId, string reason, CancellationToken ct);

    /// <summary>Always returns exactly one row — defaults to both flags enabled if the member has never set a preference.</summary>
    Task<NotificationPreferenceRow> GetNotificationPreferenceAsync(int memberId, CancellationToken ct);

    Task SetNotificationPreferenceAsync(
        int memberId, bool privateMessagePush, bool mentionPush, CancellationToken ct);
}

public sealed class PushRepository(ISqlConnectionFactory factory) : IPushRepository
{
    public async Task<int> RegisterSubscriptionAsync(
        int accountId, string endpoint, string p256dh, string authSecret, string? deviceHint,
        string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<int>(new CommandDefinition(
                "dbo.usp_PushSubscription_Register",
                new
                {
                    AccountId = accountId,
                    Endpoint = endpoint,
                    P256dh = p256dh,
                    AuthSecret = authSecret,
                    DeviceHint = deviceHint,
                    Ip = ip
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task RemoveSubscriptionAsync(int accountId, int subscriptionId, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_PushSubscription_Remove",
                new { AccountId = accountId, SubscriptionId = subscriptionId, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<PushSubscriptionRow>> GetSubscriptionsForMemberAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<PushSubscriptionRow>(new CommandDefinition(
            "dbo.usp_PushSubscription_GetForMember",
            new { MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task PruneSubscriptionAsync(int subscriptionId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_PushSubscription_Prune",
            new { SubscriptionId = subscriptionId, Reason = reason },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task<NotificationPreferenceRow> GetNotificationPreferenceAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleAsync<NotificationPreferenceRow>(new CommandDefinition(
            "dbo.usp_NotificationPreference_Get",
            new { MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task SetNotificationPreferenceAsync(
        int memberId, bool privateMessagePush, bool mentionPush, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_NotificationPreference_Set",
            new { MemberId = memberId, PrivateMessagePush = privateMessagePush, MentionPush = mentionPush },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }
}
