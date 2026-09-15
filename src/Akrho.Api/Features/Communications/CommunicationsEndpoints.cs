using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Communications;

public static class CommunicationsEndpoints
{
    public static IEndpointRouteBuilder MapCommunications(this IEndpointRouteBuilder app)
    {
        var announcements = app.MapGroup("/api/chapters/{chapterId:int}/announcements")
                                .WithTags("Announcements").RequireAuthorization();

        announcements.MapGet("", ListAnnouncements).WithName("ListAnnouncements");

        announcements.MapPost("", CreateAnnouncement).WithName("CreateAnnouncement")
            .RequireAuthorization(AuthorizationPolicies.ChapterCommsWrite);

        announcements.MapPut("/{announcementId:int}", EditAnnouncement).WithName("EditAnnouncement")
            .RequireAuthorization(AuthorizationPolicies.ChapterCommsWrite);

        announcements.MapPost("/{announcementId:int}/withdraw", WithdrawAnnouncement).WithName("WithdrawAnnouncement")
            .RequireAuthorization(AuthorizationPolicies.ChapterCommsWrite);

        var memos = app.MapGroup("/api/chapters/{chapterId:int}/memos")
                        .WithTags("Memos").RequireAuthorization();

        memos.MapGet("", ListMemos).WithName("ListMemos");

        memos.MapPost("", PublishMemo).WithName("PublishMemo")
            .RequireAuthorization(AuthorizationPolicies.ChapterCommsWrite);

        // No PUT, no DELETE — and none will ever be added. dbo.Memo is immutable once
        // published (TR_Memo_NoUpdateDelete, error 51184); there is no usp_Memo_Edit and
        // there never will be. A correction is POST /memos again with SupersedesMemoId set
        // to the memo being corrected — a new document, not a write to the old one.

        // Neither of the two routes below takes {chapterId} — a document's chapter isn't
        // known until the procedure looks it up (an announcement/memo id alone doesn't say
        // which chapter it belongs to), so there is nothing yet to hand IScopeGuard.EnsureChapter
        // to compare against. See the per-handler comments for how each one is actually gated.
        var documents = app.MapGroup("/api/documents/{documentType}/{documentId:int}")
                            .WithTags("Documents").RequireAuthorization();

        documents.MapPost("/read", MarkDocumentRead).WithName("MarkDocumentRead");

        documents.MapGet("/read-receipts", GetReadReceipts).WithName("GetDocumentReadReceipts")
            .RequireAuthorization(AuthorizationPolicies.ChapterCommsWrite);

        return app;
    }

    private static async Task<Results<Ok<PagedResult<AnnouncementDto>>, ProblemHttpResult>> ListAnnouncements(
        int chapterId, [AsParameters] AnnouncementListRequest req,
        IAnnouncementRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetForMemberAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, req.IncludeWithdrawn, ct);

            var items = rows.Select(r => new AnnouncementDto(
                r.AnnouncementId, r.Title, r.Body, r.IsUrgent,
                r.UrgentTypeId, r.UrgentTypeName, r.BloodTypeId, r.BloodTypeName,
                r.PublishDate, r.ExpiryDate is { } e ? DateOnly.FromDateTime(e) : null, r.CreatedBy,
                r.EditedBy, r.EditedDate,
                r.IsWithdrawn, r.WithdrawnBy, r.WithdrawnDate, r.WithdrawnReason,
                r.HasRead)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<AnnouncementDto>(items, total, req.Skip, req.Take));
        }
        catch (CommsException ex)
        {
            // usp_Announcement_GetForMember only ever rejects a caller who is not an active
            // member of the chapter — unreachable in the normal case, since IScopeGuard
            // already confirmed the caller's own chapter matches the route, but the
            // procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<AnnouncementCreatedDto>, ValidationProblem, ProblemHttpResult>> CreateAnnouncement(
        int chapterId, CreateAnnouncementRequest req,
        IAnnouncementRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<CreateAnnouncementRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var announcementId = await repo.CreateAsync(
                chapterId, caller.MemberId, req.Title, req.Body, req.IsUrgent,
                req.UrgentTypeId, req.BloodTypeId, req.ExpiryDate, ct);
            return TypedResults.Ok(new AnnouncementCreatedDto(announcementId));
        }
        catch (CommsException ex)
        {
            // Only ever a role check (51168) — the policy already blocked this for anyone
            // but a ChapterOfficer/ChapterAdmin, so this is the procedure's own layer.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok, ValidationProblem, NotFound, Conflict<string>, ProblemHttpResult>> EditAnnouncement(
        int chapterId, int announcementId, EditAnnouncementRequest req,
        IAnnouncementRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<EditAnnouncementRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.EditAsync(
                announcementId, caller.MemberId, req.Title, req.Body, req.IsUrgent,
                req.UrgentTypeId, req.BloodTypeId, req.ExpiryDate, ct);
            return TypedResults.Ok();
        }
        catch (CommsException ex)
        {
            return ex.Category switch
            {
                CommsErrorCategory.NotFound => TypedResults.NotFound(),
                // Withdrawal is terminal by design — the resource's state changed under the
                // caller, nothing about the request itself was invalid — 409, not 400.
                CommsErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> WithdrawAnnouncement(
        int chapterId, int announcementId, WithdrawAnnouncementRequest req,
        IAnnouncementRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<WithdrawAnnouncementRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.WithdrawAsync(announcementId, req.Reason, caller.MemberId, ct);
            return TypedResults.Ok();
        }
        catch (CommsException ex)
        {
            return ex.Category switch
            {
                CommsErrorCategory.NotFound => TypedResults.NotFound(),
                CommsErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // The proc's own "at least 10 characters — it will be shown to the whole
                // chapter" message (51173) — written for the officer reading the screen,
                // surfaced plainly rather than a generic validation error.
                CommsErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<PagedResult<MemoDto>>, ProblemHttpResult>> ListMemos(
        int chapterId, [AsParameters] MemoListRequest req,
        IMemoRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetForMemberAsync(chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

            var items = rows.Select(r => new MemoDto(
                r.MemoId, r.MemoNumber, r.Title, r.Body, r.PublishDate, r.CreatedBy,
                r.SupersedesMemoId, r.IsSuperseded, r.SupersededByMemoId, r.SupersededByMemoNumber,
                r.HasRead)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<MemoDto>(items, total, req.Skip, req.Take));
        }
        catch (CommsException ex)
        {
            // usp_Memo_GetForMember only ever rejects a caller who is not an active member of
            // the chapter — unreachable in the normal case (IScopeGuard already confirmed
            // it), procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<MemoPublishedDto>, ValidationProblem, BadRequest<string>, ProblemHttpResult>> PublishMemo(
        int chapterId, PublishMemoRequest req,
        IMemoRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<PublishMemoRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.PublishAsync(chapterId, caller.MemberId, req.Subject, req.Body, req.SupersedesMemoId, ct);
            return TypedResults.Ok(new MemoPublishedDto(result.MemoId, result.MemoNumber));
        }
        catch (CommsException ex)
        {
            return ex.Category switch
            {
                // usp_Memo_Publish's own "the memo being superseded was not found in this
                // chapter" check (51178) — a malformed reference inside the request body,
                // not a missing resource the URL itself pointed at.
                CommsErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // Only ever a role check (51177) otherwise — the policy already blocked
                // this for anyone but a ChapterOfficer/ChapterAdmin.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok, BadRequest<string>, NotFound, ProblemHttpResult>> MarkDocumentRead(
        string documentType, int documentId,
        IDocumentRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        // No {chapterId} on this route (see the header comment in MapCommunications).
        // IScopeGuard.EnsureChapter is NOT called here — there is no candidate chapterId to
        // compare caller.ChapterId against until the document has been looked up, and the
        // procedure does that lookup itself. usp_Document_MarkRead's own check IS the only
        // gate on this endpoint: it throws the SAME "Document not found" (51181) whether the
        // id doesn't exist at all or belongs to a chapter other than the caller's — the
        // identical anti-enumeration shape used everywhere else in this codebase, just with
        // the gate necessarily living inside the procedure because the endpoint itself has
        // nothing to scope against beforehand.
        try
        {
            await repo.MarkReadAsync(documentType, documentId, caller.MemberId, ct);
            return TypedResults.Ok();
        }
        catch (CommsException ex)
        {
            return ex.Category switch
            {
                CommsErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                CommsErrorCategory.NotFound => TypedResults.NotFound(),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<IReadOnlyList<ReadReceiptDto>>, NotFound, ProblemHttpResult>> GetReadReceipts(
        string documentType, int documentId,
        IDocumentRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        // Same reasoning as MarkDocumentRead above: no {chapterId} on this route, so
        // IScopeGuard.EnsureChapter isn't callable here either. The ChapterCommsWrite policy
        // above only confirms the caller holds an officer role SOMEWHERE — RequireRole is
        // not chapter-scoped by itself, unlike the {chapterId}-bearing routes elsewhere in
        // this codebase where EnsureChapter narrows it further. The real "officer of THIS
        // document's chapter" check is usp_Document_GetReadReceipts's own 51183 THROW — for
        // this one endpoint, that procedure check is the primary gate, not defence in depth.
        try
        {
            var rows = await repo.GetReadReceiptsAsync(documentType, documentId, caller.MemberId, ct);

            var items = rows.Select(r => new ReadReceiptDto(
                r.MemberId, r.GiftName,
                string.Join(' ', new[] { r.FirstName, r.LastName }.Where(s => !string.IsNullOrWhiteSpace(s))),
                r.ReadDate)).ToList();

            return TypedResults.Ok<IReadOnlyList<ReadReceiptDto>>(items);
        }
        catch (CommsException ex)
        {
            return ex.Category switch
            {
                CommsErrorCategory.NotFound => TypedResults.NotFound(),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
