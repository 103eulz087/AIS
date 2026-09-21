using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum ChapterOfficerErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when any usp_Chapter_SeatOfficer/UnseatOfficer/GetRoster call rejects. Every
/// message was written in the procedure for whoever is reading the screen — a chapter's
/// own President, or the council officer replacing one — surfaced plainly, same
/// convention as <see cref="Akrho.Infrastructure.Repositories.CouncilSeatingException"/>.
/// </summary>
public sealed class ChapterOfficerException : Exception
{
    public ChapterOfficerErrorCategory Category { get; }

    public ChapterOfficerException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            51700 or 51703 or 51711 or 51720 => ChapterOfficerErrorCategory.NotFound,
            51707 => ChapterOfficerErrorCategory.Conflict,
            51701 or 51702 or 51712 or 51713 => ChapterOfficerErrorCategory.Forbidden,
            _ => ChapterOfficerErrorCategory.BadRequest
        };
    }
}

internal static class ChapterOfficerErrors
{
    private static readonly HashSet<int> Known =
    [
        51700, 51701, 51702, 51703, 51704, 51705, 51706, 51707,
        51710, 51711, 51712, 51713, 51720
    ];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>One row of usp_Chapter_GetRoster — a chapter office seat, current or ended.</summary>
public sealed record ChapterOfficerRosterRow(
    int MemberRoleId, int OfficeId, string OfficeName, int SortOrder, bool GrantsLogin, string RoleName,
    int MemberId, string GiftName, string MemberNumber, string FullName,
    DateTime TermStart, DateTime? TermEnd, bool IsCurrent, DateTime? RenewedThrough, bool HasAccount);

public sealed record ChapterOfficerSeatResultRow(int MemberRoleId);

public interface IChapterOfficerRepository
{
    /// <summary>Throws <see cref="ChapterOfficerException"/> (NotFound).</summary>
    Task<IReadOnlyList<ChapterOfficerRosterRow>> GetRosterAsync(int chapterId, CancellationToken ct);

    /// <summary>Throws <see cref="ChapterOfficerException"/> (NotFound / Forbidden / Conflict / BadRequest).</summary>
    Task<ChapterOfficerSeatResultRow> SeatOfficerAsync(
        int requestingMemberId, int chapterId, int memberId, int officeId, DateOnly termStart, CancellationToken ct);

    /// <summary>Throws <see cref="ChapterOfficerException"/> (NotFound / Forbidden / BadRequest).</summary>
    Task UnseatOfficerAsync(int requestingMemberId, int memberRoleId, string reason, CancellationToken ct);
}

public sealed class ChapterOfficerRepository(ISqlConnectionFactory factory) : IChapterOfficerRepository
{
    public async Task<IReadOnlyList<ChapterOfficerRosterRow>> GetRosterAsync(int chapterId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ChapterOfficerRosterRow>(new CommandDefinition(
                "dbo.usp_Chapter_GetRoster",
                new { ChapterId = chapterId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (ChapterOfficerErrors.IsKnown(ex.Number))
        {
            throw new ChapterOfficerException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterOfficerSeatResultRow> SeatOfficerAsync(
        int requestingMemberId, int chapterId, int memberId, int officeId, DateOnly termStart, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChapterOfficerSeatResultRow>(new CommandDefinition(
                "dbo.usp_Chapter_SeatOfficer",
                new
                {
                    RequestingMemberId = requestingMemberId, ChapterId = chapterId, MemberId = memberId,
                    OfficeId = officeId, TermStart = termStart.ToDateTime(TimeOnly.MinValue),
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterOfficerErrors.IsKnown(ex.Number))
        {
            throw new ChapterOfficerException(ex.Number, ex.Message);
        }
    }

    public async Task UnseatOfficerAsync(int requestingMemberId, int memberRoleId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Chapter_UnseatOfficer",
                new { RequestingMemberId = requestingMemberId, MemberRoleId = memberRoleId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterOfficerErrors.IsKnown(ex.Number))
        {
            throw new ChapterOfficerException(ex.Number, ex.Message);
        }
    }
}
