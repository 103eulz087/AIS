using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Discipline;

/// <summary>
/// Corrective actions (discipline records) — the most privacy-sensitive module in this
/// codebase. Reading is open to any authenticated member of the chapter (the database
/// decides, per row/per case, whether the caller sees the narrative — see
/// ScopeGuard.CanSeeCaseNarrative's header comment and usp_CorrectiveAction_Get/
/// usp_CorrectiveAction_GetByChapter, both of which return their own CanSeeNarrative bit).
/// Filing and status updates are ChapterAdmin-only acts, gated by
/// AuthorizationPolicies.ChapterDisciplineWrite.
/// </summary>
public static class CorrectiveActionsEndpoints
{
    public static IEndpointRouteBuilder MapCorrectiveActions(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/corrective-actions")
                   .WithTags("Discipline").RequireAuthorization();

        g.MapGet("", List).WithName("ListCorrectiveActions");
        g.MapGet("/{caseId:int}", Get).WithName("GetCorrectiveAction");

        g.MapPost("", File).WithName("FileCorrectiveAction")
            .RequireAuthorization(AuthorizationPolicies.ChapterDisciplineWrite);

        g.MapPost("/{caseId:int}/updates", AddUpdate).WithName("AddCorrectiveActionUpdate")
            .RequireAuthorization(AuthorizationPolicies.ChapterDisciplineWrite);

        // There is deliberately no PUT and no DELETE anywhere on this resource. A filed
        // narrative is never edited (CLAUDE.md invariant #2) — the ONLY way a case's status
        // changes is POST .../updates, which appends a CorrectiveActionUpdate row; the
        // database rejects any UPDATE/DELETE against CorrectiveAction or
        // CorrectiveActionUpdate regardless (TR_CorrectiveAction_NoDelete,
        // TR_CorrectiveActionUpdate_NoUpdateDelete).
        return app;
    }

    private static async Task<Results<Ok<PagedResult<object>>, ProblemHttpResult>> List(
        int chapterId, [AsParameters] CorrectiveActionListRequest req,
        ICorrectiveActionRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetByChapterAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

            // Two shapes, decided per row by the database's own CanSeeNarrative bit — never
            // re-derived here. Same object-list pattern MembersEndpoints.Search already uses
            // for its own two-shape (same-chapter/cross-chapter) list.
            var items = rows.Select(object (r) => r.CanSeeNarrative
                ? new CorrectiveActionFullDto(
                    r.CaseId, r.MemberId, r.GiftName, r.MemberNumber,
                    r.CategoryId, r.CategoryName,
                    r.StatusName, DateOnly.FromDateTime(r.DateFiled),
                    r.ResolutionDate is { } rd ? DateOnly.FromDateTime(rd) : null,
                    r.Content!, r.ResolutionNotes, r.FiledBy!.Value, r.FiledByGiftName!)
                : new CorrectiveActionSummaryDto(
                    r.CaseId, r.MemberId, r.GiftName, r.MemberNumber,
                    r.CategoryId, r.CategoryName,
                    r.StatusName, DateOnly.FromDateTime(r.DateFiled),
                    r.ResolutionDate is { } rd2 ? DateOnly.FromDateTime(rd2) : null))
                .ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<object>(items, total, req.Skip, req.Take));
        }
        catch (CorrectiveActionException ex)
        {
            // usp_CorrectiveAction_GetByChapter only ever rejects a caller who is not an
            // active member of the chapter — unreachable in the normal case, since
            // IScopeGuard already confirmed the caller's own chapter matches the route, but
            // the procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<object>, NotFound>> Get(
        int chapterId, int caseId,
        ICorrectiveActionRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var detail = await repo.GetAsync(caseId, caller.MemberId, ct);
            var h = detail.Header;

            // The SAME CanSeeNarrative flag the header carries gates the timeline's shape too
            // — not a second, independent visibility decision.
            object dto = h.CanSeeNarrative
                ? new CorrectiveActionCaseFullDto(
                    new CorrectiveActionFullDto(
                        h.CaseId, h.MemberId, h.GiftName, h.MemberNumber,
                        h.CategoryId, h.CategoryName,
                        h.StatusName, DateOnly.FromDateTime(h.DateFiled),
                        h.ResolutionDate is { } rd ? DateOnly.FromDateTime(rd) : null,
                        h.Content!, h.ResolutionNotes, h.FiledBy!.Value, h.FiledByGiftName!),
                    detail.Timeline.Select(t => new CorrectiveActionTimelineEntryFullDto(
                        t.UpdateId, t.UpdateDate, t.StatusName,
                        t.UpdatedBy!.Value, t.UpdatedByGiftName!, t.Notes)).ToList())
                : new CorrectiveActionCaseSummaryDto(
                    new CorrectiveActionSummaryDto(
                        h.CaseId, h.MemberId, h.GiftName, h.MemberNumber,
                        h.CategoryId, h.CategoryName,
                        h.StatusName, DateOnly.FromDateTime(h.DateFiled),
                        h.ResolutionDate is { } rd2 ? DateOnly.FromDateTime(rd2) : null),
                    detail.Timeline.Select(t => new CorrectiveActionTimelineEntrySummaryDto(
                        t.UpdateId, t.UpdateDate, t.StatusName)).ToList());

            return TypedResults.Ok(dto);
        }
        catch (CorrectiveActionException)
        {
            // usp_CorrectiveAction_Get throws the SAME "Corrective action not found" message
            // for a nonexistent id and for a wrong-chapter caller — deliberate
            // anti-enumeration. Do not add a different response for either case.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<FiledCorrectiveActionDto>, ValidationProblem, ProblemHttpResult, BadRequest<string>>> File(
        int chapterId, FileCorrectiveActionRequest req,
        ICorrectiveActionRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<FileCorrectiveActionRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var caseId = await repo.FileAsync(
                chapterId, caller.MemberId, req.SubjectMemberId, req.CategoryId,
                req.DateFiled, req.Content, req.InitialStatusName, ct);
            return TypedResults.Ok(new FiledCorrectiveActionDto(caseId));
        }
        catch (CorrectiveActionException ex)
        {
            return ex.Category switch
            {
                // The subject does not belong to this chapter, an unrecognised category, or
                // an unrecognised status/blank narrative — the procedure's own message,
                // written for the officer filing the case.
                CorrectiveActionErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // ChapterDisciplineWrite already blocked this for anyone but a ChapterAdmin;
                // this is the procedure's own layer (defence in depth).
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<CorrectiveActionUpdateAddedDto>, ValidationProblem, NotFound, ProblemHttpResult, BadRequest<string>>> AddUpdate(
        int chapterId, int caseId, AddCorrectiveActionUpdateRequest req,
        ICorrectiveActionRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<AddCorrectiveActionUpdateRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.AddUpdateAsync(caseId, caller.MemberId, req.NewStatusName, req.Notes, ct);
            return TypedResults.Ok(new CorrectiveActionUpdateAddedDto(result.CaseId, result.StatusName));
        }
        catch (CorrectiveActionException ex)
        {
            return ex.Category switch
            {
                CorrectiveActionErrorCategory.NotFound => TypedResults.NotFound(),
                CorrectiveActionErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // ChapterDisciplineWrite already blocked this for anyone but a ChapterAdmin;
                // this is the procedure's own layer (defence in depth).
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
