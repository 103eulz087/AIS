using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace Akrho.Infrastructure.Security;

/// <summary>
/// Mints the short-lived access JWT. Claim shape is a contract with
/// <see cref="CurrentUser"/>: "mid" (member id), "chp" (chapter id), <see cref="ClaimTypes.Role"/>
/// per active role. "aid" (account id) rides along too, purely so the API can resolve which
/// account a sign-out belongs to without a request-supplied id — it is an internal row id,
/// not personal data, same category as "mid" and "chp".
/// This token carries no name, no gift name, no mobile number — see CLAUDE.md §2 invariant 8,
/// which is written about the QR credential but is the same rule.
/// </summary>
public interface IAccessTokenService
{
    AccessToken IssueAccessToken(int accountId, int memberId, int chapterId, IEnumerable<string> roles);
}

public sealed record AccessToken(string Value, DateTime ExpiresAtUtc);

public sealed class AccessTokenService(IConfiguration configuration) : IAccessTokenService
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    public AccessToken IssueAccessToken(int accountId, int memberId, int chapterId, IEnumerable<string> roles)
    {
        var signingKey = configuration["Jwt:SigningKey"]
            ?? throw new InvalidOperationException("Jwt:SigningKey is not configured.");
        var issuer = configuration["Jwt:Issuer"];
        var audience = configuration["Jwt:Audience"];
        var expiresAtUtc = DateTime.UtcNow.Add(Lifetime);

        var claims = new List<Claim>
        {
            new("mid", memberId.ToString(CultureInfo.InvariantCulture)),
            new("chp", chapterId.ToString(CultureInfo.InvariantCulture)),
            new("aid", accountId.ToString(CultureInfo.InvariantCulture)),
        };
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256);

        // Built directly from a claim list (not a SecurityTokenDescriptor + ClaimsIdentity),
        // so no legacy inbound/outbound claim-type remapping applies — the claim types set
        // here are exactly the claim types CurrentUser reads back.
        var token = new JwtSecurityToken(issuer, audience, claims,
            notBefore: DateTime.UtcNow, expires: expiresAtUtc, signingCredentials: credentials);

        var value = new JwtSecurityTokenHandler().WriteToken(token);
        return new AccessToken(value, expiresAtUtc);
    }
}
