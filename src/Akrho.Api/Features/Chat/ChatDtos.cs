namespace Akrho.Api.Features.Chat;

/// <summary>
/// GET /api/chapters/{chapterId}/chat/room result. Calling this is how the room gets lazily
/// created on first open — WasCreated is true only for the caller who actually created it.
/// </summary>
public sealed record ChatRoomDto(int RoomId, int ChapterId, string RoomName, int RetentionMonths, bool WasCreated, bool IsMuted);

/// <summary>
/// One chat message. Body is null when the message has been removed and the caller isn't an
/// officer of this chapter — withheld by the stored procedure itself, never filtered
/// client-side. CanSeeRemovedBody is a hint for how the UI should render a removed message,
/// not a decision the client makes.
/// </summary>
public sealed record ChatMessageDto(
    int MessageId, int SenderId, string SenderGiftName, string SenderMemberNumber,
    string? Body, DateTime SentDateUtc, bool IsDeleted, DateTime? DeletedDateUtc,
    int FlagCount, bool HasFlagged, bool CanSeeRemovedBody);

/// <summary>
/// POST /messages body. No chapterId, no roomId, no senderId — the caller's identity comes
/// from ICurrentUser.MemberId alone (same pattern as MembersEndpoints.UpdateOwnProfile).
/// Mentions is a HINT from the client's own mention picker (specific member ids the composer
/// already resolved) — never an authorization; usp_ChatMessage_Post re-verifies every one of
/// them server-side (same chapter, active, actually referenced in Body, not the sender
/// himself) before recording anything. Defaults to an empty list when omitted.
/// </summary>
public sealed record PostMessageRequest(string Body, List<int>? Mentions = null);

/// <summary>
/// POST /mute body — shared by the chapter-scoped Public mute route (ChatEndpoints) and every
/// Private conversation's own mute route (ConversationsEndpoints); usp_ChatParticipant_SetMute
/// itself resolves which room type it's muting, so one request shape covers both.
/// </summary>
public sealed record SetMuteRequest(bool IsMuted);

/// <summary>POST /messages/{messageId}/flag body. Reason is optional, same as the procedure's own @Reason.</summary>
public sealed record FlagMessageRequest(string? Reason);

/// <summary>
/// POST /messages/{messageId}/remove body. Reason-only — the message id being removed comes
/// from the route, never from a body property a caller could substitute.
/// </summary>
public sealed record RemoveMessageRequest(string Reason);

/// <summary>POST /messages/{messageId}/resolve-flags body. Note is optional, same as the procedure's own @Note.</summary>
public sealed record ResolveFlagsRequest(string? Note);

/// <summary>POST /read body — the caller's own read cursor, never another member's.</summary>
public sealed record MarkReadRequest(int LastReadMessageId);

/// <summary>
/// GET /messages query. BeforeMessageId is the keyset cursor (omit for the newest page). Take
/// falls back to 50 when omitted — the same "0 means unset" convention this codebase already
/// uses for [AsParameters]-bound list requests (see AnnouncementListRequest), because a
/// record's default parameter value does not apply when the query string omits the field.
/// </summary>
public sealed record ChatMessageListRequest(int? BeforeMessageId = null, int Take = 50);

/// <summary>GET /moderation-queue query. Same Take-fallback convention as ChatMessageListRequest.</summary>
public sealed record ModerationQueueListRequest(int Skip = 0, int Take = 50, bool IncludeResolved = false);

/// <summary>Result set 1 of the moderation queue — one row per flagged message. Body is always present here (officer-only screen).</summary>
public sealed record ChatFlaggedMessageDto(
    int MessageId, int SenderId, string SenderGiftName, string SenderMemberNumber,
    string? Body, DateTime SentDateUtc, bool IsDeleted, int FlagCount, int OpenFlagCount);

/// <summary>Result set 2 of the moderation queue — one row per (message, flagger) pair.</summary>
public sealed record ChatFlagDto(
    int MessageId, int MemberId, string FlaggerGiftName, string? Reason,
    DateTime FlaggedDateUtc, DateTime? ResolvedDateUtc, int? ResolvedBy);

/// <summary>GET /moderation-queue result. Total/Skip/Take describe result set 1's paging only.</summary>
public sealed record ChatModerationQueueDto(
    IReadOnlyList<ChatFlaggedMessageDto> Messages, IReadOnlyList<ChatFlagDto> Flags,
    int Total, int Skip, int Take);

/// <summary>
/// POST /messages/{messageId}/flag result, and the SignalR "MessageFlagged" broadcast payload
/// — sent to the chapter-{chapterId}-officers group only.
/// </summary>
public sealed record ChatMessageFlaggedDto(int MessageId, int FlagCount);

/// <summary>
/// POST /messages/{messageId}/remove result, and the SignalR "MessageRemoved" broadcast
/// payload — sent to chapter-{chapterId}. Deliberately messageId + deletedDate only, NEVER the
/// body, even though it's already gone from view.
/// </summary>
public sealed record ChatMessageRemovedDto(int MessageId, DateTime DeletedDateUtc);

/// <summary>POST /messages/{messageId}/resolve-flags result. Not broadcast — see ChatEndpoints.ResolveFlags.</summary>
public sealed record ChatMessageResolvedDto(int MessageId, int ResolvedCount);
