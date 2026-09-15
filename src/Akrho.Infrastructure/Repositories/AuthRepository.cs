using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

public sealed record SignInAccountRow(
    int AccountId, string PasswordHash, int FailedAttempts, DateTime? LockedUntil,
    bool IsDisabled, int MemberId, int ChapterId);

/// <summary>One row per the member's currently active role; RoleName is NULL if he holds none.</summary>
public sealed record MemberClaimRow(
    int MemberId, int ChapterId, string GiftName, string? RoleName, string? ScopeType, int? ScopeId);

/// <summary>
/// The account/member/chapter behind a freshly rotated refresh token — everything needed
/// to mint the next access token without trusting anything the caller sent.
/// </summary>
public sealed record RefreshRotateResultRow(int TokenId, int AccountId, int MemberId, int ChapterId);

public enum RefreshTokenFailureReason { NotRecognised, ReuseDetected, Expired }

/// <summary>
/// Thrown when <c>usp_RefreshToken_Rotate</c> rejects a token. All three reasons map to a
/// generic 401 at the API boundary — the distinction is for logging, not for the client.
/// </summary>
public sealed class RefreshTokenException(RefreshTokenFailureReason reason)
    : Exception("Refresh token rejected.")
{
    public RefreshTokenFailureReason Reason { get; } = reason;
}

public interface IAuthRepository
{
    Task<SignInAccountRow?> GetAccountForSignInAsync(string memberNumber, CancellationToken ct);

    Task RecordSignInResultAsync(int accountId, bool success, string? ip, CancellationToken ct);

    /// <summary>Scoped to @MemberId alone — this can never be used to read another member's roles.</summary>
    Task<IReadOnlyList<MemberClaimRow>> GetClaimsAsync(int memberId, CancellationToken ct);

    Task<int> IssueRefreshTokenAsync(
        int accountId, byte[] tokenHash, DateTime expiresOn, string? deviceHint, string? ip, CancellationToken ct);

    /// <summary>Throws <see cref="RefreshTokenException"/> if the old token is not recognised, was already used, or has expired.</summary>
    Task<RefreshRotateResultRow> RotateRefreshTokenAsync(
        byte[] oldTokenHash, byte[] newTokenHash, DateTime expiresOn, string? deviceHint, string? ip, CancellationToken ct);

    Task RevokeRefreshTokenFamilyAsync(int accountId, string reason, CancellationToken ct);
}

public sealed class AuthRepository(ISqlConnectionFactory factory) : IAuthRepository
{
    public async Task<SignInAccountRow?> GetAccountForSignInAsync(string memberNumber, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<SignInAccountRow?>(new CommandDefinition(
            "dbo.usp_Auth_GetAccountForSignIn",
            new { MemberNumber = memberNumber },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task RecordSignInResultAsync(int accountId, bool success, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_Auth_RecordSignInResult",
            new { AccountId = accountId, Success = success, Ip = ip },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<MemberClaimRow>> GetClaimsAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<MemberClaimRow>(new CommandDefinition(
            "dbo.usp_Auth_GetClaims",
            new { MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<int> IssueRefreshTokenAsync(
        int accountId, byte[] tokenHash, DateTime expiresOn, string? deviceHint, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "dbo.usp_RefreshToken_Issue",
            new
            {
                AccountId = accountId, TokenHash = tokenHash, ExpiresOn = expiresOn,
                DeviceHint = deviceHint, Ip = ip
            },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task<RefreshRotateResultRow> RotateRefreshTokenAsync(
        byte[] oldTokenHash, byte[] newTokenHash, DateTime expiresOn, string? deviceHint, string? ip,
        CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<RefreshRotateResultRow>(new CommandDefinition(
                "dbo.usp_RefreshToken_Rotate",
                new
                {
                    OldTokenHash = oldTokenHash, NewTokenHash = newTokenHash, ExpiresOn = expiresOn,
                    DeviceHint = deviceHint, Ip = ip
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number == 51140)
        {
            throw new RefreshTokenException(RefreshTokenFailureReason.NotRecognised);
        }
        catch (SqlException ex) when (ex.Number == 51141)
        {
            throw new RefreshTokenException(RefreshTokenFailureReason.ReuseDetected);
        }
        catch (SqlException ex) when (ex.Number == 51142)
        {
            throw new RefreshTokenException(RefreshTokenFailureReason.Expired);
        }
    }

    public async Task RevokeRefreshTokenFamilyAsync(int accountId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_RefreshToken_RevokeFamily",
            new { AccountId = accountId, Reason = reason },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }
}
