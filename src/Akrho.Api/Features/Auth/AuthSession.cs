using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;

namespace Akrho.Api.Features.Auth;

/// <summary>
/// Everything that happens once a caller is proven to be who he says he is: mint the
/// access token, issue a rotating refresh token, set its cookie. Shared by sign-in and
/// by enrolment-complete (which signs the officer straight in) so the two never drift.
/// </summary>
public static class AuthSession
{
    public const string RefreshCookieName = "akrho_rt";
    public static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(14);

    public static async Task<SignInResponseDto> IssueAsync(
        HttpContext http, IAuthRepository repo, IAccessTokenService tokens,
        int accountId, int memberId, string? ip, CancellationToken ct)
    {
        var claimRows = await repo.GetClaimsAsync(memberId, ct);

        // usp_Auth_GetClaims always returns at least one row for a member that exists —
        // one with a NULL RoleName if he holds no active office — so ChapterId is safe to read.
        var chapterId = claimRows.Count > 0 ? claimRows[0].ChapterId : 0;
        var roles = claimRows
            .Where(r => r.RoleName is not null)
            .Select(r => r.RoleName!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var access = tokens.IssueAccessToken(accountId, memberId, chapterId, roles);

        var rawRefresh = OpaqueToken.GenerateRaw();
        var refreshExpiresOn = DateTime.UtcNow.Add(RefreshLifetime);
        var deviceHint = DeviceHintOf(http);

        await repo.IssueRefreshTokenAsync(
            accountId, OpaqueToken.Hash(rawRefresh), refreshExpiresOn, deviceHint, ip, ct);

        SetRefreshCookie(http, rawRefresh, refreshExpiresOn);

        return new SignInResponseDto(access.Value, access.ExpiresAtUtc);
    }

    public static string? DeviceHintOf(HttpContext http)
    {
        var ua = http.Request.Headers.UserAgent.ToString();
        return string.IsNullOrEmpty(ua) ? null : ua[..Math.Min(ua.Length, 120)];
    }

    public static void SetRefreshCookie(HttpContext http, string rawToken, DateTime expiresOnUtc) =>
        http.Response.Cookies.Append(RefreshCookieName, rawToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            // Same-site is evaluated on scheme + registrable domain, not port, so this
            // still rides the dev Vite proxy (5173 -> API) as well as the single
            // production origin (CLAUDE.md invariant 11). Strict, not Lax: this cookie
            // must never go out on a cross-site navigation, only same-site fetches.
            SameSite = SameSiteMode.Strict,
            Expires = expiresOnUtc,
            Path = "/api/auth"
        });

    public static void ClearRefreshCookie(HttpContext http) =>
        http.Response.Cookies.Delete(RefreshCookieName, new CookieOptions { Path = "/api/auth" });
}
