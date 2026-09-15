using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Activities;

public static class ActivitiesEndpoints
{
    public static IEndpointRouteBuilder MapActivities(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/activities")
                   .WithTags("Activities").RequireAuthorization();

        g.MapGet("", List).WithName("ListActivities");

        g.MapPost("", Create).WithName("CreateActivity")
            .RequireAuthorization(AuthorizationPolicies.ChapterActivitiesWrite);

        g.MapPost("/{activityId:int}/close", Close).WithName("CloseActivity")
            .RequireAuthorization(AuthorizationPolicies.ChapterActivitiesWrite);

        return app;
    }

    private static async Task<Results<Ok<PagedResult<ActivityListItemDto>>, ProblemHttpResult>> List(
        int chapterId, [AsParameters] ActivityListRequest req,
        IActivityRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetByChapterAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

            var items = rows.Select(r => new ActivityListItemDto(
                r.ActivityId, r.ActivityName,
                r.ActivityDate.HasValue ? DateOnly.FromDateTime(r.ActivityDate.Value) : null,
                r.Description, r.IsClosed, r.FundedTotal, r.SpentTotal)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<ActivityListItemDto>(items, total, req.Skip, req.Take));
        }
        catch (ActivityException ex)
        {
            // usp_Activity_GetByChapter only ever rejects a caller who is not an active
            // member of the chapter — unreachable in the normal case since IScopeGuard
            // already confirmed the caller's own chapter matches the route, but the
            // procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<ActivityCreatedDto>, ValidationProblem, ProblemHttpResult>> Create(
        int chapterId, CreateActivityRequest req,
        IActivityRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<CreateActivityRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var activityId = await repo.CreateAsync(
                chapterId, caller.MemberId, req.Name, req.Description, req.ActivityDate, ct);
            return TypedResults.Ok(new ActivityCreatedDto(activityId));
        }
        catch (ActivityException ex)
        {
            // Only ever a role check — the policy already blocked this for anyone but a
            // ChapterOfficer/ChapterAdmin, so this is the procedure's own layer.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok, NotFound, Conflict<string>, ProblemHttpResult>> Close(
        int chapterId, int activityId,
        IActivityRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            await repo.CloseAsync(activityId, caller.MemberId, ct);
            return TypedResults.Ok();
        }
        catch (ActivityException ex)
        {
            return ex.Category switch
            {
                ActivityErrorCategory.NotFound => TypedResults.NotFound(),
                // Already closed — the resource's state changed under the caller, nothing
                // about the request itself was invalid — 409, not 400.
                ActivityErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
