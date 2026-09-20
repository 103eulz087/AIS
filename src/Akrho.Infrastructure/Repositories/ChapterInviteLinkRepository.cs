using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>Whether the caller's own chapter currently has a live invite link, and since
/// when — never the raw token itself (it was never stored; see
/// usp_ChapterInviteLink_Regenerate's own header for why there is no way to recover one).</summary>
public sealed record ChapterInviteLinkOwnRow(bool HasLink, DateTime? CreatedDate);

/// <summary>The chapter a live invite token resolves to, for the public "join this
/// chapter" landing page. IsValid=false collapses an unknown token, an invalidated one,
/// and one whose chapter has since gone inactive into the SAME shape — anti-enumeration,
/// see the procedure's own header comment.</summary>
public sealed record ChapterInviteLinkResolveRow(bool IsValid, int? ChapterId, string? ChapterName);

/// <summary>
/// Thrown when a ChapterInviteLink procedure rejects a call — today, only "you are not a
/// chapter admin" (51600). Surfaced plainly, same convention as every other feature
/// exception in this codebase.
/// </summary>
public sealed class ChapterInviteLinkException(string message) : Exception(message);

public interface IChapterInviteLinkRepository
{
    /// <summary>Self-only — the chapter comes from the caller's own currently-seated
    /// ChapterAdmin role, never a value he could substitute (CLAUDE.md invariant #4/#11).
    /// Throws <see cref="ChapterInviteLinkException"/> if the caller holds no ChapterAdmin
    /// seat anywhere.</summary>
    Task<ChapterInviteLinkOwnRow> GetOwnAsync(int requestingMemberId, CancellationToken ct);

    /// <summary>Invalidates any existing live link for the caller's own chapter and issues
    /// a brand-new one under the given hash, in the same transaction. Returns the new
    /// link's id — the raw token is the caller's own to keep, never persisted here.
    /// Throws <see cref="ChapterInviteLinkException"/> if the caller holds no ChapterAdmin
    /// seat anywhere.</summary>
    Task<int> RegenerateAsync(int requestingMemberId, byte[] tokenHash, CancellationToken ct);

    /// <summary>Public, unauthenticated — see the procedure's own "SCOPING EXCEPTION"
    /// header comment for why this deliberately takes no caller-identity parameter.</summary>
    Task<ChapterInviteLinkResolveRow> ResolveForApplyAsync(byte[] tokenHash, CancellationToken ct);
}

internal static class ChapterInviteLinkErrors
{
    public const int NotChapterAdmin = 51600;
}

public sealed class ChapterInviteLinkRepository(ISqlConnectionFactory factory) : IChapterInviteLinkRepository
{
    public async Task<ChapterInviteLinkOwnRow> GetOwnAsync(int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChapterInviteLinkOwnRow>(new CommandDefinition(
                "dbo.usp_ChapterInviteLink_GetOwn",
                new { RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number == ChapterInviteLinkErrors.NotChapterAdmin)
        {
            throw new ChapterInviteLinkException(ex.Message);
        }
    }

    public async Task<int> RegenerateAsync(int requestingMemberId, byte[] tokenHash, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<int>(new CommandDefinition(
                "dbo.usp_ChapterInviteLink_Regenerate",
                new { RequestingMemberId = requestingMemberId, TokenHash = tokenHash },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number == ChapterInviteLinkErrors.NotChapterAdmin)
        {
            throw new ChapterInviteLinkException(ex.Message);
        }
    }

    public async Task<ChapterInviteLinkResolveRow> ResolveForApplyAsync(byte[] tokenHash, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleAsync<ChapterInviteLinkResolveRow>(new CommandDefinition(
            "dbo.usp_ChapterInviteLink_ResolveForApply",
            new { TokenHash = tokenHash },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }
}
