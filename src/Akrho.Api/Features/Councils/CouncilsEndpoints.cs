using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Akrho.Api.Features.Councils;

/// <summary>
/// Council registration and officer seating. Every endpoint here is council-registration-
/// module-only, deliberately separate from CouncilStatisticsEndpoints (read-only rollups)
/// and ChapterRegistrationsEndpoints (a chapter's own petition/turnover) — this feature
/// is about the councils themselves: creating one, and seating/unseating its officers.
///
/// CLAUDE.md invariant #4/#11 discipline throughout: every request carries a councilId
/// or memberRoleId, but none of it is ever trusted as authorization — the underlying
/// procedure re-derives the caller's own real standing (usp_Council_ResolveSeatingAuthority)
/// every time. The RequireAuthorization policy on each route is the coarse, ROLE-only
/// pre-check; the procedure is the actual authority.
/// </summary>
public static class CouncilsEndpoints
{
    public static IEndpointRouteBuilder MapCouncils(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/councils").WithTags("Councils").RequireAuthorization();

        g.MapGet("", GetRegistry).WithName("GetCouncilRegistry")
            .RequireAuthorization(AuthorizationPolicies.CouncilRegistryRead);
        g.MapGet("/{councilId:int}/officers", GetRoster).WithName("GetCouncilRoster")
            .RequireAuthorization(AuthorizationPolicies.CouncilRegistryRead);

        g.MapGet("/{councilId:int}/eligible-officers", GetEligibleOfficers).WithName("GetEligibleCouncilOfficers")
            .RequireAuthorization(AuthorizationPolicies.CouncilSeatOfficer);
        g.MapGet("/member-lookup", MemberLookup).WithName("CouncilMemberLookup")
            .RequireAuthorization(AuthorizationPolicies.CouncilSeatOfficer);

        g.MapPost("", CreateCouncil).WithName("CreateCouncil")
            .RequireAuthorization(AuthorizationPolicies.CouncilSeatOfficer);
        g.MapPost("/{councilId:int}/officers", SeatOfficer).WithName("SeatCouncilOfficer")
            .RequireAuthorization(AuthorizationPolicies.CouncilSeatOfficer);
        // The verb is "unseat" — the seat row survives with TermEnd set, never deleted
        // (invariant #15's own logic extended to MemberRole). DELETE is the closest
        // HTTP verb to "end this," not a literal row removal.
        g.MapDelete("/{councilId:int}/officers/{memberRoleId:int}", UnseatOfficer).WithName("UnseatCouncilOfficer")
            .RequireAuthorization(AuthorizationPolicies.CouncilSeatOfficer);

        return app;
    }

    private static async Task<Results<Ok<IReadOnlyList<CouncilRegistryDto>>, ProblemHttpResult>> GetRegistry(
        int? councilId, ICouncilSeatingRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var rows = await repo.GetRegistryAsync(caller.MemberId, councilId, ct);
            IReadOnlyList<CouncilRegistryDto> items = rows.Select(r => new CouncilRegistryDto(
                r.CouncilId, r.CouncilName, r.LevelName, r.ParentCouncilId, r.Depth,
                r.IsActive, r.IsDissolved, r.HasSeatedOfficers, r.NeverConstituted, r.IsDormant,
                r.SeatedOfficerCount, r.DirectChildCouncilCount, r.DirectChapterCount, r.DirectMemberCount)).ToList();
            return TypedResults.Ok(items);
        }
        catch (CouncilSeatingException ex)
        {
            // Forbidden is the only reachable category here.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<CouncilRosterDto>, ProblemHttpResult>> GetRoster(
        int councilId, ICouncilSeatingRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var result = await repo.GetRosterAsync(caller.MemberId, councilId, ct);
            var seats = result.Seats.Select(r => new CouncilRosterSeatDto(
                r.MemberRoleId, r.CouncilOfficeId, r.OfficeName, r.RoleName,
                r.MemberId, r.GiftName, r.MemberNumber, r.FullName, r.HomeChapterName,
                DateOnly.FromDateTime(r.TermStart), r.TermEnd is { } te ? DateOnly.FromDateTime(te) : null,
                r.IsCurrent, r.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null, r.HasAccount)).ToList();
            var overrides = result.Overrides.Select(r => new CouncilSeatOverrideDto(
                r.SeatOverrideId, r.MemberRoleId, r.GiftName, r.MemberNumber,
                r.HomeChapterName, r.Reason, r.SeatedOn, r.SeatedByGiftName)).ToList();
            return TypedResults.Ok(new CouncilRosterDto(seats, overrides));
        }
        catch (CouncilSeatingException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<IReadOnlyList<CouncilOfficerCandidateDto>>, ProblemHttpResult>> GetEligibleOfficers(
        int councilId, string? search, ICouncilSeatingRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var rows = await repo.EligibleOfficersAsync(caller.MemberId, councilId, search, ct);
            IReadOnlyList<CouncilOfficerCandidateDto> items = rows.Select(r => new CouncilOfficerCandidateDto(
                r.MemberId, r.GiftName, r.MemberNumber, r.FullName, r.ChapterId, r.ChapterName,
                r.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null,
                r.IsCurrent, r.IsLapsed, r.NoMobileNumber)).ToList();
            return TypedResults.Ok(items);
        }
        catch (CouncilSeatingException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<CouncilMemberLookupDto>, NotFound, ProblemHttpResult>> MemberLookup(
        int councilId, string memberNumber, ICouncilSeatingRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var row = await repo.MemberLookupAsync(caller.MemberId, councilId, memberNumber, ct);
            if (row is null) return TypedResults.NotFound();

            return TypedResults.Ok(new CouncilMemberLookupDto(
                row.MemberId, row.GiftName, row.MemberNumber, row.ChapterName, row.StatusName,
                row.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null,
                row.IsCurrent, row.IsLapsed, row.NoMobileNumber));
        }
        catch (CouncilSeatingException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<CouncilCreatedDto>, ValidationProblem, ProblemHttpResult>> CreateCouncil(
        CreateCouncilRequest req, ICouncilSeatingRepository repo, ICurrentUser caller,
        IValidator<CreateCouncilRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.CreateAsync(
                caller.MemberId, req.ParentCouncilId, req.CouncilName,
                req.RegionId, req.ProvinceId, req.MunicipalityId, ct);
            return TypedResults.Ok(new CouncilCreatedDto(result.CouncilId, result.WasCreated));
        }
        catch (CouncilSeatingException ex)
        {
            return ex.Category switch
            {
                CouncilSeatingErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok<CouncilSeatResultDto>, ValidationProblem, NotFound, ProblemHttpResult>> SeatOfficer(
        int councilId, SeatCouncilOfficerRequest req,
        ICouncilSeatingRepository repo, IConfiguration config, ICurrentUser caller,
        IValidator<SeatCouncilOfficerRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        // Generated here, never persisted or logged — same SHOW-ONCE discipline as every
        // other enrolment link this codebase issues. Always passed through; the
        // procedure itself decides whether the nominee actually needs it (no account
        // yet, never redeemed a link) and returns a null LinkId when he does not.
        var rawToken = OpaqueToken.GenerateRaw();
        var tokenHash = OpaqueToken.Hash(rawToken);

        try
        {
            var result = await repo.SeatOfficerAsync(
                caller.MemberId, councilId, req.MemberId, req.CouncilOfficeId,
                req.TermStart, req.TermEnd, req.OutsideJurisdictionReason, tokenHash, ct);

            string? enrolmentUrl = null;
            if (result.LinkId is not null)
            {
                var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
                enrolmentUrl = $"{webOrigin}/enrol/{rawToken}";
            }

            return TypedResults.Ok(new CouncilSeatResultDto(
                result.MemberRoleId, result.WasInJurisdiction, enrolmentUrl, result.ExpiresOn));
        }
        catch (CouncilSeatingException ex)
        {
            return ex.Category switch
            {
                CouncilSeatingErrorCategory.NotFound => TypedResults.NotFound(),
                CouncilSeatingErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                CouncilSeatingErrorCategory.Conflict =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok, ValidationProblem, NotFound, ProblemHttpResult>> UnseatOfficer(
        int councilId, int memberRoleId, [FromBody] UnseatCouncilOfficerRequest req,
        ICouncilSeatingRepository repo, ICurrentUser caller,
        IValidator<UnseatCouncilOfficerRequest> validator, CancellationToken ct)
    {
        _ = councilId; // the procedure re-derives the seat's own council from memberRoleId itself
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.UnseatOfficerAsync(caller.MemberId, memberRoleId, req.Reason, ct);
            return TypedResults.Ok();
        }
        catch (CouncilSeatingException ex)
        {
            return ex.Category switch
            {
                CouncilSeatingErrorCategory.NotFound => TypedResults.NotFound(),
                CouncilSeatingErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }
}
