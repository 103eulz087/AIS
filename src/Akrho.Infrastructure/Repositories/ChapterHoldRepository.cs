using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>usp_Chapter_SearchByJurisdiction's own row shape — see that procedure's
/// header comment for the scoping rationale (mirrors MemberJurisdictionSearchRow).</summary>
public sealed record ChapterJurisdictionSearchRow(
    int ChapterId, string ChapterName, bool IsOnHold, int MemberCount,
    string? RegionName, string? ProvinceName, string? CityName, int TotalCount);

public interface IChapterHoldRepository
{
    /// <summary>Throws <see cref="ChapterJurisdictionSearchException"/> (Forbidden: no
    /// seated council office / BadRequest: search text under 2 characters).</summary>
    Task<IReadOnlyList<ChapterJurisdictionSearchRow>> SearchByJurisdictionAsync(
        int requestingMemberId, string search, int skip, int take, CancellationToken ct);

    /// <summary>Throws <see cref="ChapterHoldException"/> (NotFound / Forbidden / Conflict / BadRequest).</summary>
    Task HoldAsync(int requestingMemberId, int chapterId, string reason, CancellationToken ct);

    /// <summary>Throws <see cref="ChapterHoldException"/> (NotFound / Forbidden / Conflict / BadRequest).</summary>
    Task ReleaseAsync(int requestingMemberId, int chapterId, string reason, CancellationToken ct);
}

/// <summary>How the endpoint layer decides which HTTP status a rejected
/// usp_Chapter_SearchByJurisdiction call becomes.</summary>
public enum ChapterJurisdictionSearchErrorCategory { Forbidden, BadRequest }

public sealed class ChapterJurisdictionSearchException : Exception
{
    public ChapterJurisdictionSearchErrorCategory Category { get; }

    public ChapterJurisdictionSearchException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            51840 => ChapterJurisdictionSearchErrorCategory.Forbidden,
            _ => ChapterJurisdictionSearchErrorCategory.BadRequest   // 51841
        };
    }
}

internal static class ChapterJurisdictionSearchErrors
{
    private static readonly HashSet<int> Known = [51840, 51841];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>How the endpoint layer decides which HTTP status a rejected
/// usp_Chapter_Hold/_Release call becomes.</summary>
public enum ChapterHoldErrorCategory { NotFound, Forbidden, Conflict, BadRequest }

public sealed class ChapterHoldException : Exception
{
    public ChapterHoldErrorCategory Category { get; }

    public ChapterHoldException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            51751 or 51755 => ChapterHoldErrorCategory.NotFound,      // chapter not found
            51752 or 51756 => ChapterHoldErrorCategory.Forbidden,     // not an eligible actor
            51753 or 51757 => ChapterHoldErrorCategory.Conflict,      // already/not on hold
            _ => ChapterHoldErrorCategory.BadRequest                  // 51750/51754 — blank reason
        };
    }
}

internal static class ChapterHoldErrors
{
    private static readonly HashSet<int> Known = [51750, 51751, 51752, 51753, 51754, 51755, 51756, 51757];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

public sealed class ChapterHoldRepository(ISqlConnectionFactory factory) : IChapterHoldRepository
{
    public async Task<IReadOnlyList<ChapterJurisdictionSearchRow>> SearchByJurisdictionAsync(
        int requestingMemberId, string search, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ChapterJurisdictionSearchRow>(new CommandDefinition(
                "dbo.usp_Chapter_SearchByJurisdiction",
                new
                {
                    RequestingMemberId = requestingMemberId,   // from the token, never the body
                    Search = search,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 200)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return rows.ToList();
        }
        catch (SqlException ex) when (ChapterJurisdictionSearchErrors.IsKnown(ex.Number))
        {
            throw new ChapterJurisdictionSearchException(ex.Number, ex.Message);
        }
    }

    public async Task HoldAsync(int requestingMemberId, int chapterId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Chapter_Hold",
                new { RequestingMemberId = requestingMemberId, ChapterId = chapterId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterHoldErrors.IsKnown(ex.Number))
        {
            throw new ChapterHoldException(ex.Number, ex.Message);
        }
    }

    public async Task ReleaseAsync(int requestingMemberId, int chapterId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Chapter_Release",
                new { RequestingMemberId = requestingMemberId, ChapterId = chapterId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterHoldErrors.IsKnown(ex.Number))
        {
            throw new ChapterHoldException(ex.Number, ex.Message);
        }
    }
}
