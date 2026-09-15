using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.MembershipApplications;

public static class MembershipApplicationsEndpoints
{
    public static IEndpointRouteBuilder MapMembershipApplications(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/membership-applications").WithTags("MembershipApplications");

        // Public, unauthenticated — no account exists until a chapter admin approves (§4.1).
        // Rate-limited by caller IP (not member id — there is no authenticated caller yet).
        g.MapPost("", Submit).WithName("SubmitMembershipApplication")
            .RequireRateLimiting(RateLimiting.MembershipApplicationSubmit);

        g.MapGet("/status", GetStatus).WithName("GetMembershipApplicationStatus")
            .RequireRateLimiting(RateLimiting.MembershipApplicationStatus);

        g.MapPut("/status", Resubmit).WithName("ResubmitMembershipApplication")
            .RequireRateLimiting(RateLimiting.MembershipApplicationStatus);

        // Chapter Admin queue and decisions. No chapterId route/query segment on either GET
        // below — the chapter comes ONLY from ICurrentUser.ChapterId (the JWT), never from
        // anything the caller supplies (CLAUDE.md invariant #4 / #11).
        g.MapGet("", GetQueue).WithName("GetMembershipApplicationQueue")
            .RequireAuthorization(AuthorizationPolicies.ChapterMembershipApprove);

        g.MapGet("/{id:int}", GetOne).WithName("GetMembershipApplication")
            .RequireAuthorization(AuthorizationPolicies.ChapterMembershipApprove);

        g.MapPost("/{id:int}/approve", Approve).WithName("ApproveMembershipApplication")
            .RequireAuthorization(AuthorizationPolicies.ChapterMembershipApprove);

        g.MapPost("/{id:int}/return", Return).WithName("ReturnMembershipApplication")
            .RequireAuthorization(AuthorizationPolicies.ChapterMembershipApprove);

        g.MapPost("/{id:int}/reject", Reject).WithName("RejectMembershipApplication")
            .RequireAuthorization(AuthorizationPolicies.ChapterMembershipApprove);

        return app;
    }

    private static async Task<Results<Ok<SubmitMembershipApplicationResponseDto>, ValidationProblem, BadRequest<string>, ProblemHttpResult>> Submit(
        SubmitMembershipApplicationRequest req, IMembershipApplicationRepository repo,
        IValidator<SubmitMembershipApplicationRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var referenceNo = await repo.SubmitAsync(
                req.ChapterId, req.FirstName, req.MiddleName, req.LastName, req.GiftName,
                req.BirthDate, req.MobileNo, req.Email, req.DateSurvive,
                req.PresidentDuringSurvive, req.MasterInitiatorDuringSurvive,
                req.SeconderNameGiven, req.SeconderMemberNumberGiven, ct);

            // A double-submit (same chapter + mobile, already open) is NOT an error here —
            // usp_MembershipApplication_Submit resolves it internally and hands back the
            // SAME existing reference number. This response looks identical either way.
            return TypedResults.Ok(new SubmitMembershipApplicationResponseDto(referenceNo));
        }
        catch (MembershipApplicationException ex)
        {
            // Only ever BadRequest here (51216 bad chapter, 51217 impossible birthdate) —
            // the procedure's own message, written to be shown to the applicant, surfaced
            // plainly rather than wrapped in something generic.
            return ex.Category == MembershipApplicationErrorCategory.BadRequest
                ? TypedResults.BadRequest(ex.Message)
                : TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<Results<Ok<MembershipApplicationStatusDto>, ValidationProblem, NotFound>> GetStatus(
        [AsParameters] MembershipApplicationIdentifyQuery query, IMembershipApplicationRepository repo,
        IValidator<MembershipApplicationIdentifyQuery> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(query, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var row = await repo.GetByReferenceAsync(query.ReferenceNo, query.MobileNo, ct);

        // Empty result set — a wrong reference and a wrong mobile look IDENTICAL here, on
        // purpose (usp_MembershipApplication_GetByReference's own header comment).
        if (row is null) return TypedResults.NotFound();

        return TypedResults.Ok(new MembershipApplicationStatusDto(
            row.ReferenceNo, row.ChapterId, row.ChapterName,
            row.FirstName, row.MiddleName, row.LastName, row.GiftName, DateOnly.FromDateTime(row.BirthDate),
            row.MobileNo, row.Email, row.DateSurvive is { } ds ? DateOnly.FromDateTime(ds) : null,
            row.PresidentDuringSurvive, row.MasterInitiatorDuringSurvive,
            row.SeconderNameGiven, row.SeconderMemberNumberGiven,
            row.StatusName, row.SubmittedDate, row.DecisionReason));
    }

    private static async Task<Results<Ok<MembershipApplicationResubmitResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Resubmit(
        [AsParameters] MembershipApplicationIdentifyQuery query, ResubmitMembershipApplicationRequest req,
        IMembershipApplicationRepository repo,
        IValidator<MembershipApplicationIdentifyQuery> queryValidator,
        IValidator<ResubmitMembershipApplicationRequest> validator, CancellationToken ct)
    {
        var queryValidation = await queryValidator.ValidateAsync(query, ct);
        if (!queryValidation.IsValid) return TypedResults.ValidationProblem(queryValidation.ToDictionary());

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.ResubmitAsync(
                query.ReferenceNo, query.MobileNo, req.FirstName, req.MiddleName, req.LastName,
                req.GiftName, req.BirthDate, req.Email, req.DateSurvive,
                req.PresidentDuringSurvive, req.MasterInitiatorDuringSurvive,
                req.SeconderNameGiven, req.SeconderMemberNumberGiven, ct);

            return TypedResults.Ok(new MembershipApplicationResubmitResponseDto(result.ReferenceNo, "PendingApproval"));
        }
        catch (MembershipApplicationException ex)
        {
            return ex.Category switch
            {
                // Same "not found" for a wrong reference+mobile pair as the GET above.
                MembershipApplicationErrorCategory.NotFound => TypedResults.NotFound(),
                // Not currently ReturnedForCorrection — the resource's state changed under
                // the caller, nothing about the request itself was invalid.
                MembershipApplicationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                MembershipApplicationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError)
            };
        }
    }

    private static async Task<Results<Ok<PagedResult<MembershipApplicationQueueItemDto>>, ProblemHttpResult>> GetQueue(
        [AsParameters] MembershipApplicationQueueRequest req,
        IMembershipApplicationRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var rows = await repo.GetQueueAsync(
                caller.ChapterId, caller.MemberId, req.StatusId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

            var items = rows.Select(r => new MembershipApplicationQueueItemDto(
                r.ApplicationId, r.ReferenceNo, r.FirstName, r.MiddleName, r.LastName, r.GiftName,
                r.MobileNo, r.Email, r.StatusName, r.SubmittedDate, r.DecidedBy, r.DecidedDate)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<MembershipApplicationQueueItemDto>(items, total, req.Skip, req.Take));
        }
        catch (MembershipApplicationException ex)
        {
            // usp_MembershipApplication_GetQueue only ever rejects a caller who is not the
            // ChapterAdmin at his OWN chapter — unreachable in the normal case, since the
            // ChapterMembershipApprove policy already requires that role, but the
            // procedure's own re-check stays defence in depth (CLAUDE.md invariant #4).
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<MembershipApplicationDetailDto>, NotFound>> GetOne(
        int id, IMembershipApplicationRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var detail = await repo.GetAsync(id, caller.MemberId, ct);
            var a = detail.Application;

            var history = detail.History.Select(h => new MembershipApplicationUpdateDto(
                h.MembershipApplicationUpdateId, h.UpdateDate, h.UpdatedBy, h.StatusName, h.Notes)).ToList();

            var prior = detail.PriorApplications.Select(p => new MembershipApplicationPriorDto(
                p.ApplicationId, p.ReferenceNo, p.ChapterId, p.ChapterName,
                p.StatusName, p.SubmittedDate, p.DecidedDate, p.DecisionReason)).ToList();

            var dto = new MembershipApplicationDetailDto(
                a.ApplicationId, a.ReferenceNo, a.ChapterId,
                a.FirstName, a.MiddleName, a.LastName, a.GiftName, DateOnly.FromDateTime(a.BirthDate),
                a.MobileNo, a.Email, a.DateSurvive is { } ds ? DateOnly.FromDateTime(ds) : null,
                a.PresidentDuringSurvive, a.MasterInitiatorDuringSurvive,
                a.SeconderNameGiven, a.SeconderMemberNumberGiven, a.SeconderMemberId,
                a.SeconderResolvedGiftName, a.SeconderResolvedMemberNumber,
                a.StatusName, a.SubmittedDate,
                a.DecidedBy, a.DecidedDate, a.DecisionReason, a.CreatedMemberId,
                history, prior);

            return TypedResults.Ok(dto);
        }
        catch (MembershipApplicationException)
        {
            // usp_MembershipApplication_Get throws the SAME "Application not found" message
            // for a nonexistent id and for an application belonging to a chapter this caller
            // does not administer — deliberate anti-enumeration, mirroring usp_Meeting_Get.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<ApproveMembershipApplicationResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Approve(
        int id, ApproveMembershipApplicationRequest req, IConfiguration config,
        IMembershipApplicationRepository repo, ICurrentUser caller,
        IValidator<ApproveMembershipApplicationRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        // Generated here, exactly like EnrolmentEndpoints/dev-enrolment-link.sh — only the
        // SHA-256 hash crosses into the database. `rawToken` is a local only: it is placed
        // into ONE response object below and nowhere else — never a log statement, never a
        // field on any persisted row, never a variable captured by a closure that outlives
        // this method.
        var rawToken = OpaqueToken.GenerateRaw();
        var tokenHash = OpaqueToken.Hash(rawToken);

        try
        {
            var result = await repo.ApproveAsync(id, caller.MemberId, req.SeconderMemberId, tokenHash, null, ct);

            var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
            var enrolmentUrl = $"{webOrigin}/enrol/{rawToken}";

            // SHOW-ONCE: this is the only response that will ever carry rawToken embedded in
            // enrolmentUrl. There is deliberately no GET to re-fetch this later (mirrors
            // EnrolmentEndpoints, which only ever reads/redeems a link that already exists —
            // it never re-issues the raw value of one already issued). A lost link means the
            // chapter admin issues a fresh one, not recovering this one.
            return TypedResults.Ok(new ApproveMembershipApplicationResponseDto(
                result.MemberId, result.MemberNumber, enrolmentUrl, result.ExpiresOn));
        }
        catch (MembershipApplicationException ex)
        {
            return ex.Category switch
            {
                MembershipApplicationErrorCategory.NotFound => TypedResults.NotFound(),
                // Already decided, or the chapter has no member-number scheme configured yet
                // (51225 / 51227 / 51228) — the resource's own state blocks this, not the request.
                MembershipApplicationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // An unresolved seconder (51226).
                MembershipApplicationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // 51224 — not this chapter's admin. Unreachable via the normal path (the
                // policy already requires ChapterAdmin, and the queue/get above already
                // scope to the caller's own chapter), but the procedure's own check stays
                // defence in depth.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<MembershipApplicationDecisionResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Return(
        int id, DecideMembershipApplicationRequest req, IMembershipApplicationRepository repo, ICurrentUser caller,
        IValidator<DecideMembershipApplicationRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.ReturnAsync(id, caller.MemberId, req.Reason, ct);
            return TypedResults.Ok(new MembershipApplicationDecisionResponseDto(result.ApplicationId, "ReturnedForCorrection"));
        }
        catch (MembershipApplicationException ex)
        {
            return ex.Category switch
            {
                MembershipApplicationErrorCategory.NotFound => TypedResults.NotFound(),
                MembershipApplicationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                MembershipApplicationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<MembershipApplicationDecisionResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Reject(
        int id, DecideMembershipApplicationRequest req, IMembershipApplicationRepository repo, ICurrentUser caller,
        IValidator<DecideMembershipApplicationRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.RejectAsync(id, caller.MemberId, req.Reason, ct);
            return TypedResults.Ok(new MembershipApplicationDecisionResponseDto(result.ApplicationId, "Rejected"));
        }
        catch (MembershipApplicationException ex)
        {
            return ex.Category switch
            {
                MembershipApplicationErrorCategory.NotFound => TypedResults.NotFound(),
                MembershipApplicationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                MembershipApplicationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
