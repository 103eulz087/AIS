using Microsoft.AspNetCore.Identity;

namespace Akrho.Infrastructure.Security;

/// <summary>
/// Wraps ASP.NET Core Identity's <see cref="PasswordHasher{TUser}"/> (PBKDF2, salted,
/// versioned format) so the rest of the codebase never touches a raw password or picks
/// its own crypto. There is no "user" type to hash against — the hasher only needs
/// something to satisfy the generic constraint — so a shared dummy instance is used.
/// </summary>
public interface IPasswordHasherService
{
    string Hash(string password);

    /// <summary>True if the password matches. Never logs, never echoes, either input.</summary>
    bool Verify(string hash, string password);
}

public sealed class PasswordHasherService : IPasswordHasherService
{
    private static readonly object HashSubject = new();
    private readonly PasswordHasher<object> _hasher = new();

    public string Hash(string password) => _hasher.HashPassword(HashSubject, password);

    public bool Verify(string hash, string password)
    {
        var result = _hasher.VerifyHashedPassword(HashSubject, hash, password);
        return result is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
    }
}
