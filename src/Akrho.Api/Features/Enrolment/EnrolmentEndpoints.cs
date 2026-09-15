using Akrho.Api.Common;
using Akrho.Api.Features.Auth;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Enrolment;

public static class EnrolmentEndpoints
{
    public static IEndpointRouteBuilder MapEnrolment(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/enrolment").WithTags("Enrolment");

        g.MapGet("/{token}", Get).WithName("GetEnrolmentLink");
        g.MapPost("/{token}/complete", Complete).WithName("CompleteEnrolment")
            .RequireRateLimiting(RateLimiting.EnrolmentComplete);

        // There is deliberately no POST here to issue a link — that belongs to whatever
        // screen lets a chapter officer generate one, a later slice. This feature only
        // ever reads and redeems a link that already exists.
        return app;
    }

    private static async Task<Results<Ok<EnrolmentLinkDto>, NotFound>> Get(
        string token, IEnrolmentRepository repo, CancellationToken ct)
    {
        var row = await repo.GetAsync(OpaqueToken.Hash(token), ct);

        // Expired, redeemed, invalidated, or the hash matched nothing at all — the API
        // does not distinguish; the UI only needs "still good" or "ask your chapter again".
        if (!row.IsValid || row.ExpiresOn is not { } expiresOn)
            return TypedResults.NotFound();

        return TypedResults.Ok(new EnrolmentLinkDto(
            row.FirstName ?? string.Empty, row.GiftName ?? string.Empty,
            row.ChapterName ?? string.Empty, expiresOn));
    }

    private static async Task<Results<Ok<SignInResponseDto>, ValidationProblem, NotFound>> Complete(
        string token, EnrolmentCompleteRequest req, HttpContext http,
        IEnrolmentRepository enrolment, IAuthRepository auth,
        IPasswordHasherService hasher, IAccessTokenService tokens,
        IValidator<EnrolmentCompleteRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var ip = http.Connection.RemoteIpAddress?.ToString();
        var passwordHash = hasher.Hash(req.Password);

        EnrolmentRedeemResultRow result;
        try
        {
            result = await enrolment.RedeemAsync(OpaqueToken.Hash(token), passwordHash, ip, ct);
        }
        catch (EnrolmentException)
        {
            // Same "no longer valid" response for a bad token and for a vanished member —
            // both read to the officer as "get a new link from your chapter".
            return TypedResults.NotFound();
        }

        // Straight in, no separate sign-in round trip — same session issuance sign-in uses.
        var response = await AuthSession.IssueAsync(http, auth, tokens, result.AccountId, result.MemberId, ip, ct);
        return TypedResults.Ok(response);
    }
}
