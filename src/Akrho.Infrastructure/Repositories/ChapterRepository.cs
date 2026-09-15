using System.Data;
using Dapper;

namespace Akrho.Infrastructure.Repositories;

/// <summary>One row of the public chapter picker. Names only, see usp_Chapter_ListPublic's own header comment.</summary>
public sealed record ChapterPublicRow(int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName);

public interface IChapterRepository
{
    /// <summary>
    /// Public, unauthenticated, unscoped — deliberately so. This is the sign-up form's
    /// cascading Region → Province → City → Chapter picker, reached before anyone has
    /// signed in (CLAUDE.md §4.1 / §7A.4). There is no @RequestingMemberId here because
    /// there is no requester yet.
    /// </summary>
    Task<IReadOnlyList<ChapterPublicRow>> ListPublicAsync(CancellationToken ct);
}

public sealed class ChapterRepository(ISqlConnectionFactory factory) : IChapterRepository
{
    public async Task<IReadOnlyList<ChapterPublicRow>> ListPublicAsync(CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<ChapterPublicRow>(new CommandDefinition(
            "dbo.usp_Chapter_ListPublic",
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }
}
