using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum ChatErrorCategory { NotFound, Forbidden, BadRequest }

/// <summary>
/// Thrown when a Public- or Private-chat (or push-subscription/notification-preference)
/// stored procedure rejects a call. Every message on these THROWs was written in the
/// procedure for the member/officer reading the chat screen — surface it plainly at the
/// endpoint, never wrap it in something generic. Mirrors
/// <c>CommsException</c>/<c>DashboardException</c> — same shape, kept as ONE type across both
/// chat sub-modules (and the push-subscription procedures the Notifications feature calls)
/// rather than a parallel class, because they share this same error-mapping posture; the two
/// modules simply own disjoint THROW number ranges: Public chat 51270-51279 (see each
/// procedure's own header comment), Private chat / push / notification preferences
/// 51280-51285 (usp_ChatRoom_EnsurePrivate, usp_ChatMessage_PostPrivate/_GetPrivateHistory,
/// usp_ChatParticipant_MarkReadPrivate, usp_ChatParticipant_SetMute,
/// usp_PushSubscription_Remove).
/// </summary>
public sealed class ChatException : Exception
{
    public ChatErrorCategory Category { get; }

    public ChatException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // Not an active member of the chapter at all — usp_ChatRoom_EnsurePublic (51270),
            // usp_ChatMessage_GetHistory (51271), usp_ChatMessage_Post (51272),
            // usp_ChatParticipant_MarkRead (51279). Also usp_ChatMessage_Delete's/
            // usp_ChatMessage_ResolveFlags's OWN role check (51273 — a member of the message's
            // chapter, but not an officer/admin of it) and usp_ChatMessage_GetFlagged's
            // officer check (51276).
            51270 or 51271 or 51272 or 51273 or 51276 or 51279 => ChatErrorCategory.Forbidden,

            // Anti-enumeration merges: "message doesn't exist" and "message belongs to a
            // chapter the caller isn't even a member of" come back as the SAME code — 51274
            // (usp_ChatMessage_Delete / usp_ChatMessage_ResolveFlags) and 51275
            // (usp_ChatMessage_Flag). See each procedure's own header comment.
            51274 or 51275 => ChatErrorCategory.NotFound,

            // A malformed payload: an empty message body (51277 — usp_ChatMessage_Post) or an
            // empty removal reason (51278 — usp_ChatMessage_Delete).
            51277 or 51278 => ChatErrorCategory.BadRequest,

            // Private-chat/push module (51280-51285) ------------------------------------------

            // Anti-enumeration merges, same posture as 51274/51275 above: usp_ChatRoom_EnsurePrivate's
            // single "not permitted" (51280 — different chapters, no chapter, or the other
            // member doesn't exist, all merged); usp_ChatMessage_PostPrivate's/
            // usp_ChatMessage_GetPrivateHistory's/usp_ChatParticipant_MarkReadPrivate's shared
            // "not a participant of this room" (51282 — a nonexistent room, a Public room, and
            // a room the caller isn't a participant of all come back identically); and
            // usp_PushSubscription_Remove's "not found" (51285 — a nonexistent subscription id
            // and one that exists but belongs to a different account both come back the same
            // way, so this endpoint cannot be used to probe another account's subscriptions).
            51280 or 51282 or 51285 => ChatErrorCategory.NotFound,

            // A malformed request, not a permission problem: starting a conversation with
            // yourself (51281 — usp_ChatRoom_EnsurePrivate) or an empty private message body
            // (51283 — usp_ChatMessage_PostPrivate).
            51281 or 51283 => ChatErrorCategory.BadRequest,

            // usp_ChatParticipant_SetMute's own check — not a participant of this room at all
            // (Public or Private; a nonexistent room also lands here, since RoomType comes back
            // NULL, satisfying neither branch). See that procedure's own header comment.
            51284 => ChatErrorCategory.Forbidden,

            _ => ChatErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the Public-chat, Private-chat and
/// push-subscription procedures this repository (and <c>PushRepository</c>, same assembly)
/// calls. Anything else — a timeout, a deadlock, a dropped connection — is a real unexpected
/// error and must NOT be re-surfaced as a safe, human-authored message; it is left to
/// propagate to the generic 500 handler instead (CLAUDE.md: never leak an exception message to
/// the client).
/// </summary>
internal static class ChatErrors
{
    private static readonly HashSet<int> Known =
    [
        51270, 51271, 51272, 51273, 51274, 51275, 51276, 51277, 51278, 51279,
        51280, 51281, 51282, 51283, 51284, 51285
    ];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>One row as usp_ChatRoom_EnsurePublic leaves it.</summary>
public sealed record ChatRoomRow(int RoomId, int ChapterId, string RoomName, int RetentionMonths, bool WasCreated, bool IsMuted);

/// <summary>
/// One chat message, in the shared shape usp_ChatMessage_GetHistory and usp_ChatMessage_Post
/// both return — Body is NULL when the message has been removed and the caller isn't an
/// officer of this chapter (withheld by the procedure itself, never filtered here; see
/// usp_ChatMessage_GetHistory's own header comment).
/// </summary>
public sealed record ChatMessageRow(
    int MessageId, int SenderId, string SenderGiftName, string SenderMemberNumber,
    string? Body, DateTime SentDate, bool IsDeleted, DateTime? DeletedDate,
    int FlagCount, bool HasFlagged, bool CanSeeRemovedBody);

public sealed record ChatMessageDeleteResultRow(int MessageId, DateTime DeletedDate);

public sealed record ChatMessageFlagResultRow(int MessageId, int FlagCount);

public sealed record ChatMessageResolveFlagsResultRow(int MessageId, int ResolvedCount);

/// <summary>Result set 1 of usp_ChatMessage_GetFlagged — one row per flagged message, paged.</summary>
public sealed record ChatFlaggedMessageRow(
    int MessageId, int SenderId, string SenderGiftName, string SenderMemberNumber,
    string? Body, DateTime SentDate, bool IsDeleted, int FlagCount, int OpenFlagCount, int TotalCount);

/// <summary>
/// Result set 2 of usp_ChatMessage_GetFlagged — one row per (message, flagger) pair, for just
/// the page of messages returned in result set 1.
/// </summary>
public sealed record ChatFlagDetailRow(
    int MessageId, int MemberId, string FlaggerGiftName, string? Reason,
    DateTime FlaggedDate, DateTime? ResolvedDate, int? ResolvedBy);

public sealed record ChatModerationQueueRows(
    IReadOnlyList<ChatFlaggedMessageRow> Messages, IReadOnlyList<ChatFlagDetailRow> Flags);

/// <summary>
/// usp_ChatMessage_Post's two result sets, together: the posted message row (unchanged shape),
/// plus the MemberIds that survived server-side mention verification (empty if none did — see
/// that procedure's own header comment on what "verified" means).
/// </summary>
public sealed record ChatMessagePostResult(ChatMessageRow Message, IReadOnlyList<int> MentionedMemberIds);

/// <summary>usp_ChatRoom_EnsurePrivate's row shape.</summary>
public sealed record ChatPrivateRoomRow(
    int RoomId, int OtherMemberId, string OtherGiftName, string OtherMemberNumber,
    int OtherChapterId, string OtherChapterName, string OtherStatusName, bool IsMuted, bool WasCreated);

/// <summary>usp_ChatRoom_ListPrivate's per-row shape — one row per DM thread with at least one message.</summary>
public sealed record ChatPrivateRoomListRow(
    int RoomId, int OtherMemberId, string OtherGiftName, string? OtherChapterName,
    int? LastMessageId, string? LastMessagePreview, DateTime? LastMessageDate,
    int UnreadCount, bool IsMuted, int TotalCount);

/// <summary>
/// usp_ChatMessage_PostPrivate's row shape — identical to <see cref="ChatMessageRow"/> plus
/// RecipientMemberId, so the endpoint can address the SignalR group and enqueue a push job with
/// no second query.
/// </summary>
public sealed record ChatPrivateMessageRow(
    int MessageId, int SenderId, string SenderGiftName, string SenderMemberNumber,
    string? Body, DateTime SentDate, bool IsDeleted, DateTime? DeletedDate,
    int FlagCount, bool HasFlagged, bool CanSeeRemovedBody, int RecipientMemberId);

/// <summary>
/// usp_ChatParticipant_GetState's row shape. INTERNAL — the push-dispatch worker's own use
/// only; never surface this through a member-facing endpoint (see that procedure's own header
/// comment: it has no permission check at all, by design, because its only caller is trusted
/// server-side infrastructure).
/// </summary>
public sealed record ChatParticipantStateRow(int? LastReadMessageId, bool IsMuted);

public interface IChatRepository
{
    /// <summary>
    /// Lazily creates the chapter's Public room on first open; otherwise idempotently returns
    /// the existing one. Throws <see cref="ChatException"/> (Forbidden) if the caller is not
    /// an active member of <paramref name="chapterId"/>.
    /// </summary>
    Task<ChatRoomRow> EnsurePublicRoomAsync(int chapterId, int requestingMemberId, string? ip, CancellationToken ct);

    /// <summary>
    /// Keyset-paginated history, newest first. Throws <see cref="ChatException"/> (Forbidden)
    /// if the caller is not an active member of <paramref name="chapterId"/>.
    /// </summary>
    Task<IReadOnlyList<ChatMessageRow>> GetHistoryAsync(
        int chapterId, int requestingMemberId, int? beforeMessageId, int take, CancellationToken ct);

    /// <summary>
    /// Throws <see cref="ChatException"/> (Forbidden if the caller is not an active member of
    /// <paramref name="chapterId"/>; BadRequest if <paramref name="body"/> is empty/whitespace).
    /// Returns the created row in the same shape as <see cref="GetHistoryAsync"/> — this is
    /// what the endpoint broadcasts over SignalR without a second query — plus the MemberIds
    /// the procedure actually verified out of <paramref name="mentionedMemberIds"/> (a hint from
    /// the client's own mention picker; the procedure alone decides which, if any, survive —
    /// see usp_ChatMessage_Post's own header comment). Pass an empty list when there are none;
    /// this always sends a (possibly empty) table-valued parameter, never a null one — SQL
    /// Server does not allow a default value on a TVP.
    /// </summary>
    Task<ChatMessagePostResult> PostMessageAsync(
        int chapterId, int requestingMemberId, string body, IReadOnlyList<int> mentionedMemberIds,
        string? ip, CancellationToken ct);

    /// <summary>
    /// Officer-only soft delete. Idempotent — deleting an already-deleted message is a no-op
    /// that still returns success. Throws <see cref="ChatException"/> (Forbidden if a member
    /// of the message's chapter but not an officer/admin of it; NotFound if the message
    /// doesn't exist or the caller isn't even a member of its chapter — merged,
    /// anti-enumeration; BadRequest if <paramref name="reason"/> is empty).
    /// </summary>
    Task<ChatMessageDeleteResultRow> DeleteMessageAsync(
        int messageId, int requestingMemberId, string reason, string? ip, CancellationToken ct);

    /// <summary>
    /// Any active member of the message's own chapter may flag. A duplicate flag by the same
    /// member is a silent no-op that still returns the current FlagCount. Throws
    /// <see cref="ChatException"/> (NotFound — merged "message doesn't exist" / "caller isn't
    /// an active member of its chapter").
    /// </summary>
    Task<ChatMessageFlagResultRow> FlagMessageAsync(
        int messageId, int requestingMemberId, string? reason, string? ip, CancellationToken ct);

    /// <summary>
    /// Officer-only — closes out every currently open flag on a message. Throws
    /// <see cref="ChatException"/> (Forbidden / NotFound, same shape as
    /// <see cref="DeleteMessageAsync"/>).
    /// </summary>
    Task<ChatMessageResolveFlagsResultRow> ResolveFlagsAsync(
        int messageId, int requestingMemberId, string? note, string? ip, CancellationToken ct);

    /// <summary>
    /// Officer-only moderation queue. Throws <see cref="ChatException"/> (Forbidden) if the
    /// caller is not an officer/admin of <paramref name="chapterId"/>.
    /// </summary>
    Task<ChatModerationQueueRows> GetFlaggedAsync(
        int chapterId, int requestingMemberId, int skip, int take, bool includeResolved, CancellationToken ct);

    /// <summary>
    /// Personal read-cursor only — writes no AuditLog row by design (confirmed decision, not
    /// an oversight: a scroll position carries no organizational weight). Throws
    /// <see cref="ChatException"/> (Forbidden) if the caller is not an active member of
    /// <paramref name="chapterId"/>.
    /// </summary>
    Task MarkReadAsync(int chapterId, int requestingMemberId, int lastReadMessageId, CancellationToken ct);

    // --- Private chat (Features/Conversations) --------------------------------------------

    /// <summary>
    /// Lazily creates (or idempotently returns) the Private room for this pair of members.
    /// Same-chapter-only (docs §4.2) — both members must be active and share a chapter. Throws
    /// <see cref="ChatException"/> (NotFound — merged anti-enumeration: different chapters, no
    /// chapter, or the other member doesn't exist at all; BadRequest — a self-conversation).
    /// </summary>
    Task<ChatPrivateRoomRow> EnsurePrivateRoomAsync(
        int requestingMemberId, int otherMemberId, string? ip, CancellationToken ct);

    /// <summary>
    /// The caller's own DM inbox, newest-activity-first. Scoping is implicit and complete —
    /// the procedure only ever considers rooms the caller is a participant of, so there is no
    /// separate permission check to bypass. Only conversations with at least one message are
    /// returned.
    /// </summary>
    Task<IReadOnlyList<ChatPrivateRoomListRow>> ListPrivateRoomsAsync(
        int requestingMemberId, int skip, int take, CancellationToken ct);

    /// <summary>
    /// Posts to an EXISTING Private room — does not lazily create one (see
    /// usp_ChatMessage_PostPrivate's own header comment on why). Writes NO AuditLog row by
    /// design (confirmed decision for this module — see usp_ChatRoom_EnsurePrivate's header
    /// comment). Throws <see cref="ChatException"/> (NotFound — merged anti-enumeration: a
    /// nonexistent room, a Public room, or a room the caller isn't a participant of; BadRequest
    /// — an empty body).
    /// </summary>
    Task<ChatPrivateMessageRow> PostPrivateMessageAsync(
        int roomId, int requestingMemberId, string body, string? ip, CancellationToken ct);

    /// <summary>
    /// Keyset-paginated history for a Private room, newest first. Throws
    /// <see cref="ChatException"/> (NotFound — same merged anti-enumeration as
    /// <see cref="PostPrivateMessageAsync"/>).
    /// </summary>
    Task<IReadOnlyList<ChatMessageRow>> GetPrivateHistoryAsync(
        int roomId, int requestingMemberId, int? beforeMessageId, int take, CancellationToken ct);

    /// <summary>
    /// Personal read-cursor for a Private room — same no-audit posture as
    /// <see cref="MarkReadAsync"/>. Throws <see cref="ChatException"/> (NotFound — same merged
    /// anti-enumeration as <see cref="PostPrivateMessageAsync"/>).
    /// </summary>
    Task MarkPrivateReadAsync(int roomId, int requestingMemberId, int lastReadMessageId, CancellationToken ct);

    /// <summary>
    /// Mutes/unmutes a room for the caller — serves BOTH Public and Private rooms (the
    /// procedure resolves the room's actual type itself, never trusts a parameter for it).
    /// Throws <see cref="ChatException"/> (Forbidden — the caller is not a participant of this
    /// room at all, Public or Private; a nonexistent room lands here too).
    /// </summary>
    Task SetMuteAsync(int roomId, int requestingMemberId, bool isMuted, CancellationToken ct);

    /// <summary>
    /// INTERNAL — the push-dispatch worker's own use only, never a member-facing endpoint (see
    /// <see cref="ChatParticipantStateRow"/>'s own header comment). No permission check: the
    /// caller is trusted server-side infrastructure, not a member-facing request.
    /// </summary>
    Task<ChatParticipantStateRow> GetParticipantStateAsync(int roomId, int memberId, CancellationToken ct);
}

public sealed class ChatRepository(ISqlConnectionFactory factory) : IChatRepository
{
    public async Task<ChatRoomRow> EnsurePublicRoomAsync(int chapterId, int requestingMemberId, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChatRoomRow>(new CommandDefinition(
                "dbo.usp_ChatRoom_EnsurePublic",
                new { ChapterId = chapterId, RequestingMemberId = requestingMemberId, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ChatMessageRow>> GetHistoryAsync(
        int chapterId, int requestingMemberId, int? beforeMessageId, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ChatMessageRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_GetHistory",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    BeforeMessageId = beforeMessageId,
                    Take = Math.Clamp(take, 1, 200)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatMessagePostResult> PostMessageAsync(
        int chapterId, int requestingMemberId, string body, IReadOnlyList<int> mentionedMemberIds,
        string? ip, CancellationToken ct)
    {
        // dbo.IntList — same shape/pattern as ExpenseRepository.CreateAsync's
        // AttachmentStagingIds TVP (the first caller of dbo.IntList in this codebase). No
        // DEFAULT is possible on a TVP, so this is built and passed even when the list is
        // empty — never a null parameter.
        var table = new DataTable();
        table.Columns.Add("Value", typeof(int));
        foreach (var id in mentionedMemberIds) table.Rows.Add(id);

        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_ChatMessage_Post",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Body = body,
                    Ip = ip,
                    Mentions = table.AsTableValuedParameter("dbo.IntList")
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var message = await multi.ReadSingleAsync<ChatMessageRow>();
            var mentioned = (await multi.ReadAsync<int>()).ToList();
            return new ChatMessagePostResult(message, mentioned);
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatMessageDeleteResultRow> DeleteMessageAsync(
        int messageId, int requestingMemberId, string reason, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChatMessageDeleteResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Delete",
                new { MessageId = messageId, RequestingMemberId = requestingMemberId, Reason = reason, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatMessageFlagResultRow> FlagMessageAsync(
        int messageId, int requestingMemberId, string? reason, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChatMessageFlagResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Flag",
                new { MessageId = messageId, RequestingMemberId = requestingMemberId, Reason = reason, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatMessageResolveFlagsResultRow> ResolveFlagsAsync(
        int messageId, int requestingMemberId, string? note, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChatMessageResolveFlagsResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_ResolveFlags",
                new { MessageId = messageId, RequestingMemberId = requestingMemberId, Note = note, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatModerationQueueRows> GetFlaggedAsync(
        int chapterId, int requestingMemberId, int skip, int take, bool includeResolved, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_ChatMessage_GetFlagged",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 200),
                    IncludeResolved = includeResolved
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var messages = (await multi.ReadAsync<ChatFlaggedMessageRow>()).ToList();
            var flags = (await multi.ReadAsync<ChatFlagDetailRow>()).ToList();
            return new ChatModerationQueueRows(messages, flags);
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task MarkReadAsync(int chapterId, int requestingMemberId, int lastReadMessageId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_ChatParticipant_MarkRead",
                new { ChapterId = chapterId, RequestingMemberId = requestingMemberId, LastReadMessageId = lastReadMessageId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    // --- Private chat (Features/Conversations) --------------------------------------------

    public async Task<ChatPrivateRoomRow> EnsurePrivateRoomAsync(
        int requestingMemberId, int otherMemberId, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChatPrivateRoomRow>(new CommandDefinition(
                "dbo.usp_ChatRoom_EnsurePrivate",
                new { RequestingMemberId = requestingMemberId, OtherMemberId = otherMemberId, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ChatPrivateRoomListRow>> ListPrivateRoomsAsync(
        int requestingMemberId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ChatPrivateRoomListRow>(new CommandDefinition(
                "dbo.usp_ChatRoom_ListPrivate",
                new { RequestingMemberId = requestingMemberId, Skip = skip, Take = Math.Clamp(take, 1, 200) },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatPrivateMessageRow> PostPrivateMessageAsync(
        int roomId, int requestingMemberId, string body, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChatPrivateMessageRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_PostPrivate",
                new { RoomId = roomId, RequestingMemberId = requestingMemberId, Body = body, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ChatMessageRow>> GetPrivateHistoryAsync(
        int roomId, int requestingMemberId, int? beforeMessageId, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ChatMessageRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_GetPrivateHistory",
                new
                {
                    RoomId = roomId,
                    RequestingMemberId = requestingMemberId,
                    BeforeMessageId = beforeMessageId,
                    Take = Math.Clamp(take, 1, 200)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task MarkPrivateReadAsync(int roomId, int requestingMemberId, int lastReadMessageId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_ChatParticipant_MarkReadPrivate",
                new { RoomId = roomId, RequestingMemberId = requestingMemberId, LastReadMessageId = lastReadMessageId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task SetMuteAsync(int roomId, int requestingMemberId, bool isMuted, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_ChatParticipant_SetMute",
                new { RoomId = roomId, RequestingMemberId = requestingMemberId, IsMuted = isMuted },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChatErrors.IsKnown(ex.Number))
        {
            throw new ChatException(ex.Number, ex.Message);
        }
    }

    public async Task<ChatParticipantStateRow> GetParticipantStateAsync(int roomId, int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleAsync<ChatParticipantStateRow>(new CommandDefinition(
            "dbo.usp_ChatParticipant_GetState",
            new { RoomId = roomId, MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }
}
