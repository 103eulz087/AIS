using System.Security.Cryptography;
using System.Text;

namespace Akrho.Infrastructure.Security;

/// <summary>
/// Enrolment link tokens and refresh tokens are opaque, random bearer strings. The raw
/// value goes to the browser (a URL or a cookie); only its SHA-256 hash ever reaches the
/// database, so a stolen backup or a compromised query cannot be replayed as a live token.
/// Issue and redemption sides must hash the same way — this is the one place that happens.
/// </summary>
public static class OpaqueToken
{
    /// <summary>256 bits of randomness, base64url-encoded so it drops cleanly into a URL or a cookie.</summary>
    public static string GenerateRaw()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static byte[] Hash(string rawToken) => SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
}
