namespace Akrho.Infrastructure.Push;

/// <summary>Which template the push-dispatch worker renders for this job. See PushDispatchHostedService.</summary>
public enum PushJobKind
{
    PrivateMessage,
    Mention,
    Announcement
}

/// <summary>
/// Everything the push-dispatch worker needs to decide whether — and what — to push, and
/// nothing else. This is a deliberate structural choice, not a convention to remember: there is
/// no <c>Body</c> field on this record, and there must never be one for a chat message — push
/// notifications never contain chat message text (a lock screen is the most exposed surface in
/// the app) — making the field impossible to construct is stronger than a comment asking nobody
/// to add it. <see cref="AnnouncementTitle"/> is the one deliberate exception: an announcement's
/// title (never its body) is public to the whole chapter/org by design
/// (AnnouncementDto's own header comment), so it carries no more sensitivity on a lock screen
/// than the gift-name interpolation the other two kinds already do.
///
/// <see cref="RoomId"/>/<see cref="MessageId"/> are populated for <see cref="PushJobKind.PrivateMessage"/>
/// and <see cref="PushJobKind.Mention"/> only — usp_ChatParticipant_GetState and
/// usp_ChatParticipant_SetMute-backed mute state are both keyed by room regardless of whether
/// that room is Public or Private, and the worker checks both before ever sending anything for
/// those two kinds (see PushDispatchHostedService). <see cref="PushJobKind.Announcement"/> has no
/// room at all — its own "already seen this" check is <see cref="AnnouncementId"/> against
/// usp_Document_HasRead instead. <see cref="ChapterId"/> is populated only for
/// <see cref="PushJobKind.Mention"/> — it rides along purely for the push payload's own
/// <c>data.chapterId</c>, so the client's service worker can deep-link to the right chapter's
/// chat on tap.
/// </summary>
public sealed record PushJob(
    int? RoomId, int RecipientMemberId, string SenderGiftName, int? MessageId, PushJobKind Kind,
    int? ChapterId = null, int? AnnouncementId = null, string? AnnouncementTitle = null);

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
