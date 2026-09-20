using System.Data;
using Dapper;

namespace Akrho.Infrastructure.Repositories;

/// <summary>
/// One row of dbo.usp_ScanLog_ListForSelf — "who scanned my card, and when." ScannerGiftName and
/// ScannerChapterName are NULL together for an anonymous hit on the public verification page (no
/// ScannedByMemberId to resolve); rendering that pair as "Not signed in" or similar is the DTO/
/// frontend's job, not this repository's. The scanner's identity is never exposed beyond gift
/// name + chapter, matching every other cross-chapter data exposure in this system (CLAUDE.md
/// invariant #7).
/// </summary>
public sealed record ScanLogSelfRow(
    DateTime ScanDate, string ResultCode, bool WasOffline, string? ScannerGiftName, string? ScannerChapterName);

public interface IScanLogRepository
{
    /// <summary>
    /// Self-only, same posture as <see cref="ICredentialRepository.GetOrIssueForSelfAsync"/> — no
    /// MemberId parameter to substitute; <paramref name="memberId"/> is always the CALLER's own id
    /// from the JWT (CLAUDE.md invariant #4/#11), never a value from the request. Paged, newest
    /// first. Read-only — never throws for an empty result, just returns an empty list.
    /// </summary>
    Task<IReadOnlyList<ScanLogSelfRow>> ListForSelfAsync(
        int memberId, int pageSize, int pageNumber, CancellationToken ct);
}

public sealed class ScanLogRepository(ISqlConnectionFactory factory) : IScanLogRepository
{
    public async Task<IReadOnlyList<ScanLogSelfRow>> ListForSelfAsync(
        int memberId, int pageSize, int pageNumber, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<ScanLogSelfRow>(new CommandDefinition(
            "dbo.usp_ScanLog_ListForSelf",
            new { MemberId = memberId, PageSize = pageSize, PageNumber = pageNumber }, // MemberId from the token, never the body
            commandType: CommandType.StoredProcedure,
            cancellationToken: ct));
        return rows.ToList();
    }
}
