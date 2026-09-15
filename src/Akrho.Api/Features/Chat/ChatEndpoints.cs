using Akrho.Api.Common;
using Akrho.Infrastructure.Push;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;

namespace Akrho.Api.Features.Chat;

public static class ChatEndpoints
{
    public static IEndpointRouteBuilder MapChat(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/chat").WithTags("Chat").RequireAuthorization();

        g.MapGet("/room", GetRoom).WithName("GetChatRoom");

        g.MapGet("/messages", GetMessages).WithName("GetChatMessages");

        g.MapPost("/messages", PostMessage).WithName("PostChatMessage")
            .RequireRateLimiting(RateLimiting.ChatPost);

        g.MapPost("/messages/{messageId:int}/flag", FlagMessage).WithName("FlagChatMessage")
            .RequireRateLimiting(RateLimiting.ChatFlag);

        g.MapPost("/messages/{messageId:int}/remove", RemoveMessage).WithName("RemoveChatMessage")
            .RequireAuthorization(AuthorizationPolicies.ChapterChatModerate);

        g.MapPost("/messages/{messageId:int}/resolve-flags", ResolveFlags).WithName("ResolveChatMessageFlags")
            .RequireAuthorization(AuthorizationPolicies.ChapterChatModerate);

        g.MapGet("/moderation-queue", GetModerationQueue).WithName("GetChatModerationQueue")
            .RequireAuthorization(AuthorizationPolicies.ChapterChatModerate);

        g.MapPost("/read", MarkRead).WithName("MarkChatRead");

        // Public-room mute. Kept in this file (not Conversations) — this route DOES keep
        // scope.EnsureChapter, since it operates on a chapter's own room, unlike every route in
        // Features/Conversations.
        g.MapPost("/mute", SetMute).WithName("SetChapterChatMute");

        return app;
    }

    private static ChatMessageDto ToDto(ChatMessageRow r) => new(
        r.MessageId, r.SenderId, r.SenderGiftName, r.SenderMemberNumber,
        r.Body, r.SentDate, r.IsDeleted, r.DeletedDate, r.FlagCount, r.HasFlagged, r.CanSeeRemovedBody);

    private static async Task<Results<Ok<ChatRoomDto>, ProblemHttpResult>> GetRoom(
        int chapterId, IChatRepository repo, ICurrentUser caller, IScopeGuard scope,
        HttpContext http, CancellationToken ct)
    {
        // The caller's own chapterId must match the route's — never trust it otherwise
        // (CLAUDE.md invariant #4). Checked before any repository call, on every handler below.
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var room = await repo.EnsurePublicRoomAsync(
                chapterId, caller.MemberId, http.Connection.RemoteIpAddress?.ToString(), ct);
            return TypedResults.Ok(new ChatRoomDto(
                room.RoomId, room.ChapterId, room.RoomName, room.RetentionMonths, room.WasCreated, room.IsMuted));
        }
        catch (ChatException ex)
        {
            // usp_ChatRoom_EnsurePublic only ever rejects a caller who isn't an active member
            // of the chapter — unreachable in the normal case (IScopeGuard already confirmed
            // it), procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<IReadOnlyList<ChatMessageDto>>, ProblemHttpResult>> GetMessages(
        int chapterId, [AsParameters] ChatMessageListRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetHistoryAsync(
                chapterId, caller.MemberId, req.BeforeMessageId, req.Take == 0 ? 50 : req.Take, ct);
            return TypedResults.Ok<IReadOnlyList<ChatMessageDto>>(rows.Select(ToDto).ToList());
        }
        catch (ChatException ex)
        {
            // usp_ChatMessage_GetHistory only ever rejects a caller who isn't an active member
            // of the chapter — unreachable in the normal case, procedure's own check stays
            // defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<ChatMessageDto>, ValidationProblem, BadRequest<string>, ProblemHttpResult>> PostMessage(
        int chapterId, PostMessageRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, IValidator<PostMessageRequest> validator,
        IHubContext<ChatHub> hub, IPushJobEnqueuer pushJobs, HttpContext http, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var ip = http.Connection.RemoteIpAddress?.ToString();
            var result = await repo.PostMessageAsync(chapterId, caller.MemberId, req.Body, req.Mentions ?? [], ip, ct);
            var dto = ToDto(result.Message);

            // Broadcast only AFTER the stored procedure's transaction has committed — never
            // before. The row returned here IS the transaction's own OUTPUT, so there is no
            // risk of broadcasting a write that didn't actually happen.
            await hub.Clients.Group(ChatGroups.Chapter(chapterId)).SendAsync("MessagePosted", dto, ct);

            // Push is the ONLY new delivery path for a mention — a mentioned member already
            // receives the message itself via the "MessagePosted" broadcast above, so no
            // separate SignalR event is sent for a mention. Enqueued only now, strictly after
            // the write above returned successfully.
            if (result.MentionedMemberIds.Count > 0)
            {
                // usp_ChatMessage_Post's own message result set carries no RoomId (see its
                // header comment) — resolve it here, only when there is something to notify.
                // EnsurePublicRoomAsync is idempotent and, once the room already exists (which
                // it does — a message was just posted into it), amounts to a single SELECT.
                var room = await repo.EnsurePublicRoomAsync(chapterId, caller.MemberId, ip, ct);

                foreach (var mentionedMemberId in result.MentionedMemberIds)
                {
                    if (mentionedMemberId == caller.MemberId) continue; // defence in depth — the procedure already drops self-mentions
                    pushJobs.Enqueue(new PushJob(
                        room.RoomId, mentionedMemberId, dto.SenderGiftName, dto.MessageId, PushJobKind.Mention, chapterId));
                }
            }

            return TypedResults.Ok(dto);
        }
        catch (ChatException ex)
        {
            return ex.Category switch
            {
                // usp_ChatMessage_Post's own "a message cannot be empty" check (51277) —
                // unreachable given the validator above, procedure's own check stays defence
                // in depth.
                ChatErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // Forbidden (not an active member of the chapter) — unreachable in the normal
                // case since IScopeGuard already confirmed it.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<ChatMessageFlaggedDto>, ValidationProblem, NotFound, ProblemHttpResult>> FlagMessage(
        int chapterId, int messageId, FlagMessageRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, IValidator<FlagMessageRequest> validator,
        IHubContext<ChatHub> hub, HttpContext http, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var row = await repo.FlagMessageAsync(
                messageId, caller.MemberId, req.Reason, http.Connection.RemoteIpAddress?.ToString(), ct);
            var dto = new ChatMessageFlaggedDto(row.MessageId, row.FlagCount);

            // Officers only — a flag count is a moderation signal, not for the general
            // membership. See ChatGroups.ChapterOfficers's own header comment.
            await hub.Clients.Group(ChatGroups.ChapterOfficers(chapterId)).SendAsync("MessageFlagged", dto, ct);

            return TypedResults.Ok(dto);
        }
        catch (ChatException ex)
        {
            return ex.Category switch
            {
                // Merged anti-enumeration: the message doesn't exist, or it exists in a
                // chapter the caller isn't even a member of. See usp_ChatMessage_Flag's own
                // header comment. A caller who IS a member of the route's chapter but names a
                // messageId belonging to another chapter also lands here — EnsureChapter above
                // only confirms the ROUTE's chapterId is the caller's own, not that the
                // messageId belongs to it; that check is the procedure's own job.
                ChatErrorCategory.NotFound => TypedResults.NotFound(),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<ChatMessageRemovedDto>, ValidationProblem, NotFound, BadRequest<string>, ProblemHttpResult>> RemoveMessage(
        int chapterId, int messageId, RemoveMessageRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, IValidator<RemoveMessageRequest> validator,
        IHubContext<ChatHub> hub, HttpContext http, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var row = await repo.DeleteMessageAsync(
                messageId, caller.MemberId, req.Reason, http.Connection.RemoteIpAddress?.ToString(), ct);
            var dto = new ChatMessageRemovedDto(row.MessageId, row.DeletedDate);

            // Never the body — see ChatMessageRemovedDto's own header comment. Broadcast to
            // everyone in the chapter (not just officers): a removed message must disappear
            // from every member's live view, not just the moderators'.
            await hub.Clients.Group(ChatGroups.Chapter(chapterId)).SendAsync("MessageRemoved", dto, ct);

            return TypedResults.Ok(dto);
        }
        catch (ChatException ex)
        {
            return ex.Category switch
            {
                // Merged anti-enumeration — same reasoning as FlagMessage above.
                ChatErrorCategory.NotFound => TypedResults.NotFound(),
                // usp_ChatMessage_Delete's own "a reason is required" check (51278) —
                // unreachable given the validator above, procedure's own check stays defence
                // in depth.
                ChatErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // Forbidden (a member of the message's chapter, but not an officer/admin of
                // it) — unreachable in the normal case, the ChapterChatModerate policy already
                // blocked this; procedure's own check stays defence in depth.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<ChatMessageResolvedDto>, ValidationProblem, NotFound, ProblemHttpResult>> ResolveFlags(
        int chapterId, int messageId, ResolveFlagsRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, IValidator<ResolveFlagsRequest> validator,
        HttpContext http, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var row = await repo.ResolveFlagsAsync(
                messageId, caller.MemberId, req.Note, http.Connection.RemoteIpAddress?.ToString(), ct);

            // No broadcast: resolving flags changes nothing on a live member's or officer's
            // message list — it only affects the moderation queue's own next GET, which every
            // officer screen already refetches on open.
            return TypedResults.Ok(new ChatMessageResolvedDto(row.MessageId, row.ResolvedCount));
        }
        catch (ChatException ex)
        {
            return ex.Category switch
            {
                ChatErrorCategory.NotFound => TypedResults.NotFound(),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<ChatModerationQueueDto>, ProblemHttpResult>> GetModerationQueue(
        int chapterId, [AsParameters] ModerationQueueListRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetFlaggedAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, req.IncludeResolved, ct);

            var messages = rows.Messages.Select(m => new ChatFlaggedMessageDto(
                m.MessageId, m.SenderId, m.SenderGiftName, m.SenderMemberNumber,
                m.Body, m.SentDate, m.IsDeleted, m.FlagCount, m.OpenFlagCount)).ToList();

            var flags = rows.Flags.Select(f => new ChatFlagDto(
                f.MessageId, f.MemberId, f.FlaggerGiftName, f.Reason,
                f.FlaggedDate, f.ResolvedDate, f.ResolvedBy)).ToList();

            var total = rows.Messages.Count > 0 ? rows.Messages[0].TotalCount : 0;
            return TypedResults.Ok(new ChatModerationQueueDto(messages, flags, total, req.Skip, req.Take));
        }
        catch (ChatException ex)
        {
            // usp_ChatMessage_GetFlagged's own officer check (51276) — the
            // ChapterChatModerate policy already blocked this; procedure's own check stays
            // defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok, ValidationProblem, ProblemHttpResult>> MarkRead(
        int chapterId, MarkReadRequest req,
        IChatRepository repo, ICurrentUser caller, IScopeGuard scope, IValidator<MarkReadRequest> validator,
        CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.MarkReadAsync(chapterId, caller.MemberId, req.LastReadMessageId, ct);
            return TypedResults.Ok();
        }
        catch (ChatException ex)
        {
            // usp_ChatParticipant_MarkRead only ever rejects a caller who isn't an active
            // member of the chapter — unreachable in the normal case, procedure's own check
            // stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok, ProblemHttpResult>> SetMute(
        int chapterId, SetMuteRequest req, IChatRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            // usp_ChatParticipant_SetMute takes a RoomId, not a chapterId — resolve the
            // chapter's own Public room first. EnsurePublicRoomAsync is idempotent and cheap
            // once the room already exists (a SELECT), same reasoning as GetRoom above.
            var room = await repo.EnsurePublicRoomAsync(chapterId, caller.MemberId, null, ct);
            await repo.SetMuteAsync(room.RoomId, caller.MemberId, req.IsMuted, ct);
            return TypedResults.Ok();
        }
        catch (ChatException ex)
        {
            // usp_ChatParticipant_SetMute's only failure (51284) is "not a participant of this
            // room" — unreachable in the normal case since IScopeGuard/EnsurePublicRoomAsync
            // already confirmed active membership; procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }
}
