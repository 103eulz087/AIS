using Akrho.Api.Common;
using Akrho.Api.Features.Chat;
using Akrho.Infrastructure.Push;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;

namespace Akrho.Api.Features.Conversations;

/// <summary>
/// Private (one-to-one) chat between two members of the SAME chapter. Deliberately its own
/// top-level route group — NOT nested under Features/Chat — because none of these routes take a
/// chapterId at all: a private room isn't chapter-scoped, so there is no
/// <c>scope.EnsureChapter</c> call anywhere in this file, by design. Every handler's
/// authorization is entirely "does the stored procedure accept this caller" — the caller's own
/// identity always comes from <see cref="ICurrentUser"/>, never from the request body.
/// </summary>
public static class ConversationsEndpoints
{
    public static IEndpointRouteBuilder MapConversations(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/conversations").WithTags("Conversations").RequireAuthorization();

        g.MapPost("", StartConversation).WithName("StartConversation")
            .RequireRateLimiting(RateLimiting.ConversationStart);

        g.MapGet("", ListConversations).WithName("ListConversations");

        g.MapGet("/{roomId:int}/messages", GetMessages).WithName("GetConversationMessages");

        g.MapPost("/{roomId:int}/messages", PostMessage).WithName("PostConversationMessage")
            .RequireRateLimiting(RateLimiting.PrivateChatPost);

        g.MapPost("/{roomId:int}/read", MarkRead).WithName("MarkConversationRead");

        g.MapPost("/{roomId:int}/mute", SetMute).WithName("SetConversationMute");

        return app;
    }

    private static ChatMessageDto ToDto(ChatMessageRow r) => new(
        r.MessageId, r.SenderId, r.SenderGiftName, r.SenderMemberNumber,
        r.Body, r.SentDate, r.IsDeleted, r.DeletedDate, r.FlagCount, r.HasFlagged, r.CanSeeRemovedBody);

    private static async Task<Results<Ok<ConversationStartedDto>, ValidationProblem, BadRequest<string>, NotFound>> StartConversation(
        StartConversationRequest req, IChatRepository repo, ICurrentUser caller,
        IValidator<StartConversationRequest> validator, HttpContext http, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var row = await repo.EnsurePrivateRoomAsync(
                caller.MemberId, req.WithMemberId, http.Connection.RemoteIpAddress?.ToString(), ct);

            return TypedResults.Ok(new ConversationStartedDto(
                row.RoomId, row.OtherMemberId, row.OtherGiftName, row.OtherMemberNumber,
                row.OtherChapterId, row.OtherChapterName, row.OtherStatusName, row.IsMuted, row.WasCreated));
        }
        catch (ChatException ex)
        {
            return ex.Category switch
            {
                // Anti-enumeration merge — usp_ChatRoom_EnsurePrivate's own posture: different
                // chapters, no chapter, and "that member doesn't exist" all come back
                // identically (51280). See that procedure's own header comment.
                ChatErrorCategory.NotFound => TypedResults.NotFound(),
                // Self-conversation (51281).
                _ => TypedResults.BadRequest(ex.Message)
            };
        }
    }

    private static async Task<Ok<PagedResult<ConversationSummaryDto>>> ListConversations(
        [AsParameters] ConversationsListRequest req, IChatRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        var rows = await repo.ListPrivateRoomsAsync(caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

        var items = rows.Select(r => new ConversationSummaryDto(
            r.RoomId, r.OtherMemberId, r.OtherGiftName, r.OtherChapterName,
            r.LastMessageId, r.LastMessagePreview, r.LastMessageDate, r.UnreadCount, r.IsMuted)).ToList();

        var total = rows.Count > 0 ? rows[0].TotalCount : 0;
        return TypedResults.Ok(new PagedResult<ConversationSummaryDto>(items, total, req.Skip, req.Take));
    }

    private static async Task<Results<Ok<IReadOnlyList<ChatMessageDto>>, NotFound>> GetMessages(
        int roomId, [AsParameters] PrivateMessageListRequest req, IChatRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var rows = await repo.GetPrivateHistoryAsync(
                roomId, caller.MemberId, req.BeforeMessageId, req.Take == 0 ? 50 : req.Take, ct);
            return TypedResults.Ok<IReadOnlyList<ChatMessageDto>>(rows.Select(ToDto).ToList());
        }
        catch (ChatException)
        {
            // usp_ChatMessage_GetPrivateHistory's only failure (51282) is the merged
            // anti-enumeration check — a nonexistent room, a Public room, and a room the
            // caller isn't a participant of all come back the same way (NotFound category).
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<ChatMessageDto>, ValidationProblem, BadRequest<string>, NotFound>> PostMessage(
        int roomId, PostPrivateMessageRequest req,
        IChatRepository repo, ICurrentUser caller, IValidator<PostPrivateMessageRequest> validator,
        IHubContext<ChatHub> hub, IPushJobEnqueuer pushJobs, HttpContext http, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var row = await repo.PostPrivateMessageAsync(
                roomId, caller.MemberId, req.Body, http.Connection.RemoteIpAddress?.ToString(), ct);

            var dto = new ChatMessageDto(
                row.MessageId, row.SenderId, row.SenderGiftName, row.SenderMemberNumber,
                row.Body, row.SentDate, row.IsDeleted, row.DeletedDate, row.FlagCount, row.HasFlagged, row.CanSeeRemovedBody);

            // Broadcast only AFTER the write above has committed — the row IS the
            // transaction's own OUTPUT. A private room has no chapter group to broadcast to,
            // so this goes to both participants' own "member-{id}" groups instead (see
            // ChatGroups.Member).
            await hub.Clients.Group(ChatGroups.Member(caller.MemberId)).SendAsync("PrivateMessagePosted", dto, ct);
            await hub.Clients.Group(ChatGroups.Member(row.RecipientMemberId)).SendAsync("PrivateMessagePosted", dto, ct);

            // Enqueued only now, strictly after the database write above returned
            // successfully — never before. PushJob carries no body field to leak (see its own
            // header comment) — only the sender's gift name.
            pushJobs.Enqueue(new PushJob(roomId, row.RecipientMemberId, row.SenderGiftName, row.MessageId, PushJobKind.PrivateMessage));

            return TypedResults.Ok(dto);
        }
        catch (ChatException ex)
        {
            return ex.Category switch
            {
                // Anti-enumeration — a nonexistent room, a Public room, and a room the caller
                // isn't a participant of all come back the same way (51282).
                ChatErrorCategory.NotFound => TypedResults.NotFound(),
                // An empty body (51283) — unreachable given the validator above, procedure's
                // own check stays defence in depth.
                _ => TypedResults.BadRequest(ex.Message)
            };
        }
    }

    private static async Task<Results<Ok, ValidationProblem, NotFound>> MarkRead(
        int roomId, MarkPrivateReadRequest req, IChatRepository repo, ICurrentUser caller,
        IValidator<MarkPrivateReadRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.MarkPrivateReadAsync(roomId, caller.MemberId, req.LastReadMessageId, ct);
            return TypedResults.Ok();
        }
        catch (ChatException)
        {
            // Merged anti-enumeration (51282), same shape as GetMessages/PostMessage above.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok, ProblemHttpResult>> SetMute(
        int roomId, SetMuteRequest req, IChatRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            await repo.SetMuteAsync(roomId, caller.MemberId, req.IsMuted, ct);
            return TypedResults.Ok();
        }
        catch (ChatException ex)
        {
            // usp_ChatParticipant_SetMute's only failure (51284) is "not a participant of this
            // room at all" (a nonexistent room lands here too) — Forbidden category.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }
}
