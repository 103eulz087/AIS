namespace Akrho.Api.Common;

/// <summary>Named rate-limit policies. Both guard endpoints that accept a caller-supplied secret.</summary>
public static class RateLimiting
{
    public const string SignIn = "auth-sign-in";
    public const string EnrolmentComplete = "enrolment-complete";

    /// <summary>
    /// Guards POST /api/attachments. The caller is already authenticated here (unlike
    /// SignIn/EnrolmentComplete), so this partitions by member id rather than IP — several
    /// officers behind the same NAT/proxy must not throttle each other.
    /// </summary>
    public const string AttachmentUpload = "attachment-upload";

    /// <summary>
    /// Guards POST /api/members/me/photo/stage. Same reasoning as <see cref="AttachmentUpload"/>
    /// (already authenticated, partitions by member id, not IP) — a separate named policy
    /// because this is a distinct, open-to-every-member endpoint, not a relaxation of
    /// AttachmentUpload's Treasurer-only gate.
    /// </summary>
    public const string ProfilePhotoUpload = "profile-photo-upload";

    /// <summary>
    /// Guards POST /api/membership-applications — public sign-up, nobody is authenticated
    /// yet. Unlike AttachmentUpload, there is no member id to partition by, so this (and
    /// <see cref="MembershipApplicationStatus"/>) partition by caller IP instead, the same
    /// way SignIn/EnrolmentComplete do.
    /// </summary>
    public const string MembershipApplicationSubmit = "membership-application-submit";

    /// <summary>
    /// Guards GET/PUT /api/membership-applications/status — the public "check my
    /// application" and "resubmit after correction" lookups. Both accept a caller-supplied
    /// reference number + mobile number pair and must not be hammerable (an unlimited guesser
    /// could otherwise brute-force a valid reference/mobile combination). Partitioned by
    /// caller IP, same reasoning as <see cref="MembershipApplicationSubmit"/>.
    /// </summary>
    public const string MembershipApplicationStatus = "membership-application-status";

    /// <summary>
    /// Guards POST /api/chapters/{chapterId}/chat/messages. Already authenticated, so this
    /// partitions by member id like <see cref="AttachmentUpload"/>/<see cref="ProfilePhotoUpload"/>
    /// — one chapter's shared NAT/proxy must not throttle every member's chat at once. 20/minute
    /// is generous for a real conversation but rules out a scripted flood.
    /// </summary>
    public const string ChatPost = "chat-post";

    /// <summary>
    /// Guards POST /api/chapters/{chapterId}/chat/messages/{messageId}/flag. Same
    /// member-id partitioning reasoning as <see cref="ChatPost"/>. Flagging is rarer than
    /// posting, so the limit is tighter — 10/minute is plenty for genuine reports and rules
    /// out a scripted mass-flag campaign against another member's messages.
    /// </summary>
    public const string ChatFlag = "chat-flag";

    /// <summary>
    /// Guards POST /api/conversations/{roomId}/messages — Private chat. Same member-id
    /// partitioning reasoning and the same 20/minute limit as <see cref="ChatPost"/>; a private
    /// conversation is a different feature/route from the Public room, but the same "generous
    /// for a real conversation, rules out a scripted flood" rationale applies unchanged.
    /// </summary>
    public const string PrivateChatPost = "private-chat-post";

    /// <summary>
    /// Guards POST /api/conversations — starting a brand-new DM thread with another member.
    /// Partitioned by member id, same as every other authenticated policy above. Tighter than
    /// <see cref="PrivateChatPost"/> (10/minute) because, this slice, it is the ONLY control on
    /// who may be contacted at all — an unlimited caller could otherwise machine-gun
    /// conversation invites at every other member of his chapter in a minute.
    /// </summary>
    public const string ConversationStart = "conversation-start";

    /// <summary>
    /// Guards POST /api/chapter-registrations and GET/PUT /api/chapter-registrations/status —
    /// the public charter petition and its "check my registration"/"resubmit after correction"
    /// lookups. Nobody is authenticated yet for any of the three, so all partition by caller IP,
    /// same shape as <see cref="MembershipApplicationSubmit"/>/<see cref="MembershipApplicationStatus"/>.
    /// </summary>
    public const string ChapterRegistrationSubmit = "chapter-registration-submit";

    /// <summary>See <see cref="ChapterRegistrationSubmit"/> — the status/resubmit pair, same
    /// reasoning as <see cref="MembershipApplicationStatus"/> distinguishing itself from
    /// <see cref="MembershipApplicationSubmit"/> (a caller-supplied reference+mobile pair that
    /// must not be hammerable).</summary>
    public const string ChapterRegistrationStatus = "chapter-registration-status";

    /// <summary>
    /// Guards POST /api/verifications and GET /api/verifications/{token}/photo — the public,
    /// unauthenticated credential scan/verify page and its photo lookup. Nobody is
    /// authenticated, so this partitions by caller IP, same shape as
    /// <see cref="MembershipApplicationStatus"/>/<see cref="ChapterRegistrationStatus"/> (a
    /// caller-supplied token that must not be hammerable/enumerable).
    /// </summary>
    public const string CredentialVerify = "credential-verify";
}
