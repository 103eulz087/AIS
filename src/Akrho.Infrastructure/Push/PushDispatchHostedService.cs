using System.Threading.Channels;
using Akrho.Infrastructure.Repositories;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Akrho.Infrastructure.Push;

/// <summary>
/// Owns the queue of push jobs and drains it off the request thread. A feature endpoint never
/// talks to a room's, member's or push service's state directly for this purpose — it only ever
/// calls <see cref="IPushJobEnqueuer.Enqueue"/> AFTER its own database write has committed, and
/// this worker decides, later, whether anything is actually sent.
///
/// Per job: wait a short configurable delay (Push:DispatchDelaySeconds, default 7) so a
/// recipient who is already looking at the conversation/chapter chat has a chance to mark it
/// read before a push fires at all; re-check <c>usp_ChatParticipant_GetState</c> (has he
/// already read past this message? is the room muted?) and
/// <c>usp_NotificationPreference_Get</c> (has he turned this KIND of push off?); only then fetch
/// his subscriptions and send. A 404/410 from the push service prunes that one subscription; any
/// other failure is logged and dropped — this slice does not build a retry queue.
///
/// Jobs are processed concurrently, each on its own fire-and-forget task, so one job's delay
/// never holds up the next job being picked off the channel.
/// </summary>
public sealed class PushDispatchHostedService(
    IServiceScopeFactory scopeFactory, IPushSender pushSender, IConfiguration configuration,
    ILogger<PushDispatchHostedService> logger)
    : BackgroundService, IPushJobEnqueuer
{
    private readonly Channel<PushJob> _channel = Channel.CreateUnbounded<PushJob>();

    public void Enqueue(PushJob job) => _channel.Writer.TryWrite(job);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            // Fire-and-forget on purpose: ProcessJobAsync catches everything itself, so a
            // faulted task here never crashes this loop or blocks the next job's delay from
            // starting immediately.
            _ = ProcessJobAsync(job, stoppingToken);
        }
    }

    private async Task ProcessJobAsync(PushJob job, CancellationToken ct)
    {
        try
        {
            var delaySeconds = int.TryParse(configuration["Push:DispatchDelaySeconds"], out var configured)
                ? configured : 7;
            await Task.Delay(TimeSpan.FromSeconds(delaySeconds), ct);

            using var scope = scopeFactory.CreateScope();
            var chatRepository = scope.ServiceProvider.GetRequiredService<IChatRepository>();
            var pushRepository = scope.ServiceProvider.GetRequiredService<IPushRepository>();

            var state = await chatRepository.GetParticipantStateAsync(job.RoomId, job.RecipientMemberId, ct);
            if (state.LastReadMessageId is { } lastRead && lastRead >= job.MessageId)
                return; // Already seen it in-app — the whole point of the delay above.
            if (state.IsMuted)
                return;

            var preferences = await pushRepository.GetNotificationPreferenceAsync(job.RecipientMemberId, ct);
            var enabled = job.Kind switch
            {
                PushJobKind.PrivateMessage => preferences.PrivateMessagePush,
                PushJobKind.Mention => preferences.MentionPush,
                _ => false
            };
            if (!enabled)
                return;

            var subscriptions = await pushRepository.GetSubscriptionsForMemberAsync(job.RecipientMemberId, ct);
            if (subscriptions.Count == 0)
                return;

            // Fixed templates. The ONLY thing ever interpolated is the sender's gift name —
            // never the message body (this record has no such field to interpolate — see
            // PushJob's own header comment), never a legal name, never a mobile number.
            var (title, body, data) = job.Kind switch
            {
                PushJobKind.PrivateMessage => (
                    "AKRHO",
                    $"New message from {job.SenderGiftName}",
                    (object)new { type = "private", roomId = job.RoomId }),
                PushJobKind.Mention => (
                    "AKRHO",
                    $"{job.SenderGiftName} mentioned you in the chapter chat",
                    (object)new { type = "mention", chapterId = job.ChapterId }),
                _ => throw new InvalidOperationException($"Unknown push job kind: {job.Kind}")
            };

            foreach (var subscription in subscriptions)
            {
                try
                {
                    await pushSender.SendAsync(subscription, title, body, data, ct);
                }
                catch (PushSubscriptionGoneException)
                {
                    // The push SERVICE itself says this endpoint is dead — hard-delete it
                    // rather than keep retrying a subscription that can never succeed again.
                    await pushRepository.PruneSubscriptionAsync(
                        subscription.SubscriptionId, "push service reported 404/410", ct);
                }
                catch (Exception ex)
                {
                    // Best-effort: log and move on. No inline retry queue this slice — a real
                    // future failure shows up in FailureCount-driven backoff logic later, not
                    // here.
                    logger.LogWarning(ex,
                        "Push delivery failed for subscription {SubscriptionId} (member {MemberId})",
                        subscription.SubscriptionId, job.RecipientMemberId);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Normal shutdown — the delay or a downstream await was cancelled. Not an error.
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Push dispatch failed for job {@Job}", job);
        }
    }
}
