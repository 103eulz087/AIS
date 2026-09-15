namespace Akrho.Api.Features.Conversations;

/// <summary>
/// POST /api/conversations body. The ONLY identifier here is the OTHER member — the caller's
/// own identity comes from ICurrentUser.MemberId alone, same posture as every self-scoped
/// endpoint elsewhere in this app. Deliberately no chapterId: a private room isn't
/// chapter-scoped (usp_ChatRoom_EnsurePrivate itself decides whether the two members share a
/// chapter — see that procedure's own header comment), so there is nothing here for
/// IScopeGuard to check.
/// </summary>
public sealed record StartConversationRequest(int WithMemberId);

/// <summary>POST /api/conversations result — usp_ChatRoom_EnsurePrivate's row, unchanged shape.</summary>
public sealed record ConversationStartedDto(
    int RoomId, int OtherMemberId, string OtherGiftName, string OtherMemberNumber,
    int OtherChapterId, string OtherChapterName, string OtherStatusName, bool IsMuted, bool WasCreated);

/// <summary>One row of GET /api/conversations — the caller's own DM inbox, newest-activity-first.</summary>
public sealed record ConversationSummaryDto(
    int RoomId, int OtherMemberId, string OtherGiftName, string? OtherChapterName,
    int? LastMessageId, string? LastMessagePreview, DateTime? LastMessageDate,
    int UnreadCount, bool IsMuted);

/// <summary>
/// GET /api/conversations query. Same "0 means unset, falls back to 50" Take convention as
/// Features/Chat's ChatMessageListRequest — a record's default parameter value does not apply
/// when the query string omits the field.
/// </summary>
public sealed record ConversationsListRequest(int Skip = 0, int Take = 50);

/// <summary>GET /api/conversations/{roomId}/messages query. Same Take-fallback convention as ConversationsListRequest.</summary>
public sealed record PrivateMessageListRequest(int? BeforeMessageId = null, int Take = 50);

/// <summary>
/// POST /api/conversations/{roomId}/messages body. No roomId, no memberId, no senderId beyond
/// the route's own {roomId} — the caller's identity comes from ICurrentUser alone.
/// </summary>
public sealed record PostPrivateMessageRequest(string Body);

/// <summary>POST /api/conversations/{roomId}/read body — the caller's own read cursor, never another member's.</summary>
public sealed record MarkPrivateReadRequest(int LastReadMessageId);
