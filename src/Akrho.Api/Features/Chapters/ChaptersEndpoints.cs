using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Akrho.Api.Features.Chapters;

public static class ChaptersEndpoints
{
    public static IEndpointRouteBuilder MapChapters(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters").WithTags("Chapters");

        // Deliberately no RequireAuthorization() at the GROUP level — this group is a mix.
        // ListPublicChapters and GetInviteLink below are the public sign-up form's two
        // entry points (CLAUDE.md §4.1 / §7A.4): the cascading Region -> Province -> City
        // -> Chapter picker for someone with no link, and the direct "you're joining THIS
        // chapter" landing page for someone who has one. Both are reached before anyone
        // has signed in, so both stay outside RequireAuthorization(). The invite-link
        // management routes further down ARE authenticated, each explicitly.
        g.MapGet("", List).WithName("ListPublicChapters");
        // Same rate-limit policy as the credential module's own public token lookups
        // (usp_Credential_VerifyPublic) — brute force is infeasible against a 256-bit
        // token either way, but this is the same defence-in-depth posture regardless.
        g.MapGet("/invite/{token}", GetInviteLink).WithName("GetChapterInviteLink")
            .RequireRateLimiting(RateLimiting.CredentialVerify);

        // Self-service, same posture as GET/POST /api/members/me/*: the chapter comes
        // from the caller's own currently-seated ChapterAdmin role (re-derived inside the
        // procedure itself), never from anything in the route or body — CLAUDE.md
        // invariant #4/#11.
        g.MapGet("/me/invite-link", GetOwnInviteLink).WithName("GetOwnChapterInviteLink").RequireAuthorization();
        g.MapPost("/me/invite-link/regenerate", RegenerateOwnInviteLink).WithName("RegenerateOwnChapterInviteLink").RequireAuthorization();

        // Officer seat/unseat — a chapter's own President manages every office except his
        // own; only the council above the chapter can act on the President seat itself.
        // The route carries chapterId, but the procedure never trusts it as authorization
        // (CLAUDE.md invariant #4) — usp_Chapter_SeatOfficer/_UnseatOfficer re-derive the
        // caller's own real standing every time. ChapterOfficerSeat is only the coarse,
        // ROLE-only pre-check (see that policy's own header comment).
        g.MapGet("/{chapterId:int}/officers", GetOfficerRoster).WithName("GetChapterOfficerRoster")
            .RequireAuthorization(AuthorizationPolicies.ChapterOfficerSeat);
        g.MapPost("/{chapterId:int}/officers", SeatOfficer).WithName("SeatChapterOfficer")
            .RequireAuthorization(AuthorizationPolicies.ChapterOfficerSeat);
        g.MapDelete("/{chapterId:int}/officers/{memberRoleId:int}", UnseatOfficer).WithName("UnseatChapterOfficer")
            .RequireAuthorization(AuthorizationPolicies.ChapterOfficerSeat);

        return app;
    }

    private static async Task<Ok<IReadOnlyList<ChapterPublicDto>>> List(
        IChapterRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListPublicAsync(ct);
        IReadOnlyList<ChapterPublicDto> items = rows
            .Select(r => new ChapterPublicDto(r.ChapterId, r.ChapterName, r.RegionName, r.ProvinceName, r.CityName))
            .ToList();
        return TypedResults.Ok(items);
    }

    private static async Task<Ok<ChapterInviteLinkResolvedDto>> GetInviteLink(
        string token, IChapterInviteLinkRepository repo, CancellationToken ct)
    {
        var row = await repo.ResolveForApplyAsync(OpaqueToken.Hash(token), ct);
        return TypedResults.Ok(new ChapterInviteLinkResolvedDto(row.IsValid, row.ChapterId, row.ChapterName));
    }

    private static async Task<Results<Ok<ChapterInviteLinkStatusDto>, ProblemHttpResult>> GetOwnInviteLink(
        IChapterInviteLinkRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var row = await repo.GetOwnAsync(caller.MemberId, ct);
            return TypedResults.Ok(new ChapterInviteLinkStatusDto(row.HasLink, row.CreatedDate));
        }
        catch (ChapterInviteLinkException ex)
        {
            // 51600 — the caller holds no ChapterAdmin seat anywhere. Surfaced as 403, not
            // 404: the endpoint exists, the caller simply lacks the standing to use it.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<ChapterInviteLinkIssuedDto>, ProblemHttpResult>> RegenerateOwnInviteLink(
        IConfiguration config, IChapterInviteLinkRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        // Generated here, never persisted or logged — same SHOW-ONCE discipline as every
        // other bearer token this codebase issues (enrolment links, verification tokens).
        var rawToken = OpaqueToken.GenerateRaw();
        var tokenHash = OpaqueToken.Hash(rawToken);

        try
        {
            await repo.RegenerateAsync(caller.MemberId, tokenHash, ct);

            var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
            var joinUrl = $"{webOrigin}/j/{rawToken}";

            return TypedResults.Ok(new ChapterInviteLinkIssuedDto(joinUrl, DateTime.UtcNow));
        }
        catch (ChapterInviteLinkException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<IReadOnlyList<ChapterOfficerRosterSeatDto>>, ProblemHttpResult>> GetOfficerRoster(
        int chapterId, IChapterOfficerRepository repo, CancellationToken ct)
    {
        try
        {
            var rows = await repo.GetRosterAsync(chapterId, ct);
            IReadOnlyList<ChapterOfficerRosterSeatDto> items = rows.Select(r => new ChapterOfficerRosterSeatDto(
                r.MemberRoleId, r.OfficeId, r.OfficeName, r.SortOrder, r.GrantsLogin, r.RoleName,
                r.MemberId, r.GiftName, r.MemberNumber, r.FullName,
                DateOnly.FromDateTime(r.TermStart), r.TermEnd is { } te ? DateOnly.FromDateTime(te) : null,
                r.IsCurrent, r.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null, r.HasAccount)).ToList();
            return TypedResults.Ok(items);
        }
        catch (ChapterOfficerException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status404NotFound);
        }
    }

    private static async Task<Results<Ok<ChapterOfficerSeatResultDto>, ValidationProblem, NotFound, ProblemHttpResult>> SeatOfficer(
        int chapterId, SeatChapterOfficerRequest req,
        IChapterOfficerRepository repo, ICurrentUser caller,
        IValidator<SeatChapterOfficerRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.SeatOfficerAsync(caller.MemberId, chapterId, req.MemberId, req.OfficeId, req.TermStart, ct);
            return TypedResults.Ok(new ChapterOfficerSeatResultDto(result.MemberRoleId));
        }
        catch (ChapterOfficerException ex)
        {
            return ex.Category switch
            {
                ChapterOfficerErrorCategory.NotFound => TypedResults.NotFound(),
                ChapterOfficerErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                ChapterOfficerErrorCategory.Conflict =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok, ValidationProblem, NotFound, ProblemHttpResult>> UnseatOfficer(
        int chapterId, int memberRoleId, [FromBody] UnseatChapterOfficerRequest req,
        IChapterOfficerRepository repo, ICurrentUser caller,
        IValidator<UnseatChapterOfficerRequest> validator, CancellationToken ct)
    {
        _ = chapterId; // the procedure re-derives the seat's own chapter from memberRoleId itself
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.UnseatOfficerAsync(caller.MemberId, memberRoleId, req.Reason, ct);
            return TypedResults.Ok();
        }
        catch (ChapterOfficerException ex)
        {
            return ex.Category switch
            {
                ChapterOfficerErrorCategory.NotFound => TypedResults.NotFound(),
                ChapterOfficerErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }
}
