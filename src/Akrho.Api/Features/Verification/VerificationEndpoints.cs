using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Verification;

public static class VerificationEndpoints
{
    public static IEndpointRouteBuilder MapVerification(this IEndpointRouteBuilder app)
    {
        // Genuinely public, unauthenticated — same posture as MembershipApplicationsEndpoints'
        // Submit/GetStatus: no .RequireAuthorization() anywhere in this group is what makes it
        // reachable with no account (there's no global auth fallback policy in this codebase).
        // Anyone with a phone camera and no app reaches this (docs §4.10).
        var g = app.MapGroup("/api/verifications").WithTags("Verification");

        // POST, not GET — this writes a ScanLog row as a side effect
        // (usp_Credential_VerifyPublic's own header comment); a GET must never have one.
        g.MapPost("", Verify).WithName("VerifyCredential")
            .RequireRateLimiting(RateLimiting.CredentialVerify);

        g.MapGet("/{token:guid}/photo", GetPhoto).WithName("GetVerificationPhoto")
            .RequireRateLimiting(RateLimiting.CredentialVerify);

        return app;
    }

    private static async Task<Results<Ok<PublicVerificationDto>, ValidationProblem>> Verify(
        VerifyTokenRequest req, IPublicVerificationRepository repo,
        IValidator<VerifyTokenRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var row = await repo.VerifyAsync(req.Token, req.WasOffline, req.DeviceHint, ct);

        // Only ever emitted when IsValid — same lowercase, hyphenated ("D") Guid formatting
        // CredentialEndpoints already uses for /verify/{...}. Emitting the URL unconditionally
        // when valid and letting the photo endpoint's own 404 mean "no photo on file" mirrors
        // MembersEndpoints' own PhotoUrl posture (CLAUDE.md §8.12) — never detect "has a photo"
        // here.
        var photoUrl = row.IsValid
            ? $"/api/verifications/{req.Token.ToString("D").ToLowerInvariant()}/photo"
            : null;

        return TypedResults.Ok(new PublicVerificationDto(
            row.IsValid, row.GiftName, row.ChapterName, row.StatusName,
            row.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null,
            photoUrl));
    }

    private static async Task<Results<FileStreamHttpResult, NotFound>> GetPhoto(
        Guid token, IPublicVerificationRepository repo, CancellationToken ct)
    {
        try
        {
            var (stream, contentType, photoPath) = await repo.GetPhotoAsync(token, ct);

            // Forces Content-Disposition: attachment — same stored-XSS mitigation
            // MembersEndpoints.GetPhoto/AttachmentsEndpoints.Download already use. photoPath is
            // itself an opaque, server-generated name, safe to reuse as the download filename.
            return TypedResults.Stream(stream, contentType ?? "application/octet-stream", photoPath);
        }
        catch (PhotoNotFoundException)
        {
            // Identical 404 for a bad token, a revoked/expired credential, a valid credential
            // with no photo on file, and a photo missing from this environment's disk —
            // anti-enumeration, usp_Credential_GetPhotoForVerification's own header comment.
            return TypedResults.NotFound();
        }
    }
}
