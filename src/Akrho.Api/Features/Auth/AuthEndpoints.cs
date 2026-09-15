using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/auth").WithTags("Auth");

        g.MapPost("/sign-in", SignIn).WithName("SignIn").RequireRateLimiting(RateLimiting.SignIn);
        g.MapPost("/refresh", Refresh).WithName("RefreshToken");
        g.MapPost("/sign-out", SignOut).WithName("SignOut").RequireAuthorization();
        g.MapGet("/me", Me).WithName("Me").RequireAuthorization();

        return app;
    }

    private static async Task<Results<Ok<SignInResponseDto>, UnauthorizedHttpResult, ValidationProblem>> SignIn(
        SignInRequest req, HttpContext http, IAuthRepository repo, IPasswordHasherService hasher,
        IAccessTokenService tokens, IValidator<SignInRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var ip = http.Connection.RemoteIpAddress?.ToString();
        var account = await repo.GetAccountForSignInAsync(req.MemberNumber, ct);

        // No such account, disabled, locked out, or wrong password — every one of these
        // returns the same generic 401. Never let the response say which reason it was;
        // that would tell an attacker whether a member number exists at all.
        if (account is null)
            return TypedResults.Unauthorized();

        if (account.IsDisabled || (account.LockedUntil is { } lockedUntil && lockedUntil > DateTime.UtcNow))
        {
            await repo.RecordSignInResultAsync(account.AccountId, success: false, ip, ct);
            return TypedResults.Unauthorized();
        }

        if (!hasher.Verify(account.PasswordHash, req.Password))
        {
            await repo.RecordSignInResultAsync(account.AccountId, success: false, ip, ct);
            return TypedResults.Unauthorized();
        }

        await repo.RecordSignInResultAsync(account.AccountId, success: true, ip, ct);

        var response = await AuthSession.IssueAsync(http, repo, tokens, account.AccountId, account.MemberId, ip, ct);
        return TypedResults.Ok(response);
    }

    private static async Task<Results<Ok<SignInResponseDto>, UnauthorizedHttpResult>> Refresh(
        HttpContext http, IAuthRepository repo, IAccessTokenService tokens, CancellationToken ct)
    {
        if (!http.Request.Cookies.TryGetValue(AuthSession.RefreshCookieName, out var rawOld)
            || string.IsNullOrEmpty(rawOld))
            return TypedResults.Unauthorized();

        var ip = http.Connection.RemoteIpAddress?.ToString();
        var rawNew = OpaqueToken.GenerateRaw();
        var newExpiresOn = DateTime.UtcNow.Add(AuthSession.RefreshLifetime);

        RefreshRotateResultRow rotated;
        try
        {
            rotated = await repo.RotateRefreshTokenAsync(
                OpaqueToken.Hash(rawOld), OpaqueToken.Hash(rawNew), newExpiresOn,
                AuthSession.DeviceHintOf(http), ip, ct);
        }
        catch (RefreshTokenException)
        {
            // Not recognised, reused, or expired — all three sign the caller back to a
            // full sign-in. The distinction is for the audit trail the stored procedure
            // already wrote, not for the client.
            AuthSession.ClearRefreshCookie(http);
            return TypedResults.Unauthorized();
        }

        var claimRows = await repo.GetClaimsAsync(rotated.MemberId, ct);
        var roles = claimRows
            .Where(r => r.RoleName is not null)
            .Select(r => r.RoleName!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var access = tokens.IssueAccessToken(rotated.AccountId, rotated.MemberId, rotated.ChapterId, roles);
        AuthSession.SetRefreshCookie(http, rawNew, newExpiresOn);

        return TypedResults.Ok(new SignInResponseDto(access.Value, access.ExpiresAtUtc));
    }

    private static async Task<Ok> SignOut(HttpContext http, IAuthRepository repo, CancellationToken ct)
    {
        // Sign-out issued with a valid access token: "aid" was minted at sign-in/refresh
        // time, so the account to revoke comes from the token, never from the request.
        var accountIdClaim = http.User.FindFirst("aid")?.Value;
        if (int.TryParse(accountIdClaim, out var accountId))
            await repo.RevokeRefreshTokenFamilyAsync(accountId, "sign-out", ct);

        AuthSession.ClearRefreshCookie(http);
        return TypedResults.Ok();
    }

    private static async Task<Ok<MeResponseDto>> Me(
        ICurrentUser caller, IAuthRepository repo, CancellationToken ct)
    {
        var claimRows = await repo.GetClaimsAsync(caller.MemberId, ct);
        var giftName = claimRows.Count > 0 ? claimRows[0].GiftName : string.Empty;
        var roles = claimRows
            .Where(r => r.RoleName is not null)
            .Select(r => r.RoleName!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        // ChapterName: no stored procedure currently hands a member's own chapter name
        // back with his claims (usp_Auth_GetClaims does not join dbo.Chapter), and this
        // endpoint does not reach around that with an inline query. Gap noted for a
        // follow-up proc (extend usp_Auth_GetClaims, or a small usp_Chapter_GetName) —
        // until then the frontend keeps its AppShell hardcode.
        return TypedResults.Ok(new MeResponseDto(caller.MemberId, caller.ChapterId, null, giftName, roles));
    }
}
