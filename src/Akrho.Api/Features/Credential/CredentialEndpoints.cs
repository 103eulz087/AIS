using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
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
