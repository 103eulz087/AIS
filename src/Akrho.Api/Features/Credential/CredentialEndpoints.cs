using Akrho.Api.Features.Verification;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Credential;

public static class CredentialEndpoints
{
    public static IEndpointRouteBuilder MapCredential(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/members/me").WithTags("Credential").RequireAuthorization();

        // Self-service, same posture as GET /api/members/me — no memberId anywhere in the
        // route or the request. The caller's own identity comes from ICurrentUser (the JWT)
        // alone, never from the request (CLAUDE.md invariant #4/#11).
        g.MapGet("/credential", GetMyCredential).WithName("GetMyCredential");

        // "Who scanned my card, and when" — the other half of the scan/verify pair, self-only,
        // same posture as GetMyCredential above.
        g.MapGet("/scans", GetMyScans).WithName("GetMyScans");

        // Deliberately NOT under the /api/members/me group prefix — this is the in-app,
        // signed-in SCAN action (the caller scanning someone else's card), not a read of the
        // caller's own resource, even though it still lives in this feature folder (same
        // domain as usp_Credential_VerifyForMember/usp_ScanLog_ListForSelf above).
        app.MapPost("/api/scans", Scan).WithTags("Credential").RequireAuthorization().WithName("ScanCredential");

        return app;
    }

    private static async Task<Results<Ok<MyCredentialDto>, NotFound>> GetMyCredential(
        ICredentialRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var row = await repo.GetOrIssueForSelfAsync(caller.MemberId, ct);
            return TypedResults.Ok(ToDto(row));
        }
        catch (CredentialException)
        {
            // usp_Credential_GetOrIssueForSelf only ever rejects a caller whose own member row
            // is gone — unreachable in the normal case (an authenticated caller IS an existing
            // member), but the procedure's own check stays defence in depth.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<MemberScanResultDto>, ValidationProblem>> Scan(
        ScanRequest req, ICredentialRepository repo, IValidator<ScanRequest> validator,
        ICurrentUser caller, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        // RequestingMemberId is the CALLER's own id from the JWT (CLAUDE.md invariant #4/#11),
        // never anything from the body. Never throws for a bad/revoked/expired token — that's
        // the IsValid=false case the procedure itself returns as an ordinary row.
        var row = await repo.VerifyForMemberAsync(req.Token, caller.MemberId, req.WasOffline, req.DeviceHint, ct);

        return TypedResults.Ok(new MemberScanResultDto(
            row.IsValid, row.GiftName, row.ChapterName, row.StatusName,
            row.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null,
            row.IsSameChapter, row.FullName, row.MemberNumber, row.BloodTypeName));
    }

    private static async Task<Ok<IReadOnlyList<ScanLogEntryDto>>> GetMyScans(
        [AsParameters] ScanLogListQuery query, IScanLogRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        // Self-only — memberId is always the CALLER's own id (CLAUDE.md invariant #4/#11),
        // never a value the caller could substitute to read someone else's scan history.
        var rows = await repo.ListForSelfAsync(caller.MemberId, query.PageSize, query.PageNumber, ct);

        var items = rows.Select(r => new ScanLogEntryDto(
            r.ScanDate, r.ResultCode, r.WasOffline, r.ScannerGiftName, r.ScannerChapterName)).ToList();

        return TypedResults.Ok<IReadOnlyList<ScanLogEntryDto>>(items);
    }

    private static MyCredentialDto ToDto(MemberCredentialRow r)
    {
        var fullName = string.Join(' ', new[] { r.FirstName, r.MiddleName, r.LastName }
            .Where(s => !string.IsNullOrWhiteSpace(s)));

        return new MyCredentialDto(
            r.GiftName, fullName, r.MemberNumber,
            r.ChapterName, r.ChapterCode,
            r.NationalCouncilName, r.RegionName, r.ProvinceName, r.CityName,
            r.DateSurvive is { } ds ? DateOnly.FromDateTime(ds) : null,
            r.BloodTypeName,
            r.StatusName,
            r.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null,
            r.CredentialIssuedDate, r.CredentialExpiryDate,
            // Opaque credential id only — never MemberId, never a name (CLAUDE.md invariant
            // #8). Relative path so the frontend resolves it against its own origin, not a
            // hardcoded domain. Lowercase, hyphenated ("D") format.
            $"/verify/{r.TokenSubject.ToString("D").ToLowerInvariant()}");
    }
}
