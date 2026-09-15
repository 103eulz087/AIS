using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Donations;

public static class DonationsEndpoints
{
    public static IEndpointRouteBuilder MapDonations(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/donations")
                   .WithTags("Donations").RequireAuthorization();

        g.MapGet("", List).WithName("ListDonations");
        g.MapGet("/{donationId:int}", Get).WithName("GetDonation");

        g.MapPost("", Create).WithName("CreateDonation")
            .RequireAuthorization(AuthorizationPolicies.ChapterMoneyWrite);

        // Narrower than ChapterMoneyWrite — ChapterAdmin only, same policy and reasoning as
        // Expense void.
        g.MapPost("/{donationId:int}/void", Void).WithName("VoidDonation")
            .RequireAuthorization(AuthorizationPolicies.ChapterMoneyVoid);

        return app;
    }

    private static async Task<Results<Ok<PagedResult<DonationListItemDto>>, ProblemHttpResult>> List(
        int chapterId, [AsParameters] DonationListRequest req,
        IDonationRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetByChapterAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take,
                req.ActivityId, req.FromDate, req.ToDate, req.IncludeVoided, ct);

            var items = rows.Select(r => new DonationListItemDto(
                r.DonationId, r.ActivityId, r.ActivityName, DateOnly.FromDateTime(r.DonationDate), r.DonorName,
                r.TypeName ?? r.DonorType, r.Amount, r.InKindDescription != null, r.InKindDescription,
                r.ChapterReceiptNo, r.RecordedBy, r.IsVoided)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<DonationListItemDto>(items, total, req.Skip, req.Take));
        }
        catch (DonationException ex)
        {
            // usp_Donation_GetByChapter only ever rejects a caller who is not an active
            // member of the chapter — unreachable in the normal case since IScopeGuard
            // already confirmed the caller's own chapter matches the route, but the
            // procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<DonationDetailDto>, NotFound>> Get(
        int chapterId, int donationId,
        IDonationRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var detail = await repo.GetAsync(donationId, caller.MemberId, ct);

            var voidHistory = detail.VoidHistory
                .Select(v => new DonationVoidDto(v.DonationVoidId, v.VoidedBy, v.VoidedDate, v.Reason, v.ReversedLedgerEntryId))
                .ToList();

            var h = detail.Header;
            var dto = new DonationDetailDto(
                h.DonationId, h.ChapterId, h.ActivityId, h.ActivityName, DateOnly.FromDateTime(h.DonationDate),
                h.DonorName, h.TypeName ?? h.DonorType, h.Amount, h.InKindDescription != null, h.InKindDescription,
                h.ChapterReceiptNo, h.RecordedBy, h.IsVoided, voidHistory);

            return TypedResults.Ok(dto);
        }
        catch (DonationException)
        {
            // Same "Donation not found" for a nonexistent id and a wrong-chapter caller —
            // deliberate anti-enumeration.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<DonationCreatedDto>, ValidationProblem, BadRequest<string>, ProblemHttpResult>> Create(
        int chapterId, CreateDonationRequest req,
        IDonationRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<CreateDonationRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.CreateAsync(
                chapterId, caller.MemberId, req.DonorName, req.DonorTypeId, req.Amount,
                req.InKindDescription, req.ChapterReceiptNo, req.ActivityId, req.Notes, ct);

            return TypedResults.Ok(new DonationCreatedDto(result.DonationId, result.LedgerEntryId));
        }
        catch (DonationException ex)
        {
            return ex.Category switch
            {
                // Neither cash nor in-kind, an unrecognised donor type/activity — the
                // procedure's own message, written for whoever is filing the donation.
                DonationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // Only ever a role check — ChapterMoneyWrite already blocked this for
                // anyone but a ChapterTreasurer/ChapterAdmin.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<VoidDonationResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Void(
        int chapterId, int donationId, VoidDonationRequest req,
        IDonationRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<VoidDonationRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.VoidAsync(donationId, req.Reason, caller.MemberId, ct);
            return TypedResults.Ok(new VoidDonationResponseDto(result.DonationId, result.ReversedLedgerEntryId));
        }
        catch (DonationException ex)
        {
            return ex.Category switch
            {
                DonationErrorCategory.NotFound => TypedResults.NotFound(),
                // Already voided — the resource's state changed under the caller, nothing
                // about the request itself was invalid — 409, not 400.
                DonationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // The procedure's own "at least 10 characters" message.
                DonationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
