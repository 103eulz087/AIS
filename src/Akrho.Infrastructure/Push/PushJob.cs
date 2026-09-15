namespace Akrho.Infrastructure.Push;

/// <summary>Which template the push-dispatch worker renders for this job. See PushDispatchHostedService.</summary>
public enum PushJobKind
{
    PrivateMessage,
    Mention
}

/// <summary>
/// Everything the push-dispatch worker needs to decide whether — and what — to push, and
/// nothing else. This is a deliberate structural choice, not a convention to remember: there is
/// no <c>Body</c> field on this record, and there must never be one. Push notifications never
/// contain message text (a lock screen is the most exposed surface in the app) — making the
/// field impossible to construct is stronger than a comment asking nobody to add it.
///
/// <see cref="RoomId"/> is always populated, for BOTH kinds — usp_ChatParticipant_GetState and
/// usp_ChatParticipant_SetMute-backed mute state are both keyed by room regardless of whether
/// that room is Public or Private, and the worker checks both before ever sending anything (see
/// PushDispatchHostedService). <see cref="ChapterId"/> is populated only for
/// <see cref="PushJobKind.Mention"/> — it rides along purely for the push payload's own
/// <c>data.chapterId</c>, so the client's service worker can deep-link to the right chapter's
/// chat on tap.
/// </summary>
public sealed record PushJob(
    int RoomId, int RecipientMemberId, string SenderGiftName, int MessageId, PushJobKind Kind,
    int? ChapterId = null);

/// <summary>
/// The producer-facing half of <see cref="PushDispatchHostedService"/> — a feature endpoint
/// depends on this, never on the hosted service's concrete type, and never reaches into its
/// internal channel directly.
/// </summary>
public interface IPushJobEnqueuer
{
    /// <summary>
    /// Enqueues a push job. The caller (a feature endpoint) must only ever call this AFTER the
    /// underlying database write has committed successfully — never before. This method itself
    /// does no I/O and cannot fail from the caller's point of view; delivery (or the decision
    /// not to deliver) happens later, off the request thread, in the worker.
    /// </summary>
    void Enqueue(PushJob job);
}
