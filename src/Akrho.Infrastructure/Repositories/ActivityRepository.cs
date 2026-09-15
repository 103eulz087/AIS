using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum ActivityErrorCategory { NotFound, Conflict, Forbidden }

/// <summary>
/// Thrown when an Activity stored procedure rejects a call. Same pattern as
/// <see cref="MeetingException"/> — every message was written in the procedure to reach
/// the officer reading the screen; surface it plainly.
/// </summary>
public sealed class ActivityException : Exception
{
    public ActivityErrorCategory Category { get; }

    public ActivityException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Activity not found" — usp_Activity_Close.
            51187 => ActivityErrorCategory.NotFound,

            // Already closed — the resource's own state changed under the caller, nothing
            // about the request itself was invalid.
            51188 => ActivityErrorCategory.Conflict,

            // Role/chapter checks the procedure itself enforces (defence in depth alongside
            // the ChapterActivitiesWrite policy and IScopeGuard).
            51185 or 51186 or 51189 => ActivityErrorCategory.Forbidden,

            _ => ActivityErrorCategory.Forbidden
        };
    }
}

internal static class ActivityErrors
{
    private static readonly HashSet<int> Known = [51185, 51186, 51187, 51188, 51189];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// FundedTotal/SpentTotal are activity-wide rollups only (donations received / expenses
/// posted against THIS activity) — never per donor, never per member. See
/// usp_Activity_GetByChapter's header comment; do not add a finer-grained aggregate here.
/// </summary>
public sealed record ActivityListRow(
    int ActivityId, string ActivityName, DateTime? ActivityDate, string? Description,
    bool IsClosed, decimal FundedTotal, decimal SpentTotal, int TotalCount);

public interface IActivityRepository
{
    /// <summary>Throws <see cref="ActivityException"/> (Forbidden) if the caller is not a chapter officer/admin.</summary>
    Task<int> CreateAsync(
        int chapterId, int requestingMemberId, string name, string? description,
        DateOnly? activityDate, CancellationToken ct);

    Task<IReadOnlyList<ActivityListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct);

    /// <summary>Throws <see cref="ActivityException"/> (NotFound / Conflict / Forbidden).</summary>
    Task CloseAsync(int activityId, int requestingMemberId, CancellationToken ct);
}

public sealed class ActivityRepository(ISqlConnectionFactory factory) : IActivityRepository
{
    public async Task<int> CreateAsync(
        int chapterId, int requestingMemberId, string name, string? description,
        DateOnly? activityDate, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_Activity_Create",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Name = name,
                    Description = description,
                    ActivityDate = activityDate.HasValue ? activityDate.Value.ToDateTime(TimeOnly.MinValue) : (DateTime?)null
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ActivityErrors.IsKnown(ex.Number))
        {
            throw new ActivityException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ActivityListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ActivityListRow>(new CommandDefinition(
                "dbo.usp_Activity_GetByChapter",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (ActivityErrors.IsKnown(ex.Number))
        {
            throw new ActivityException(ex.Number, ex.Message);
        }
    }

    public async Task CloseAsync(int activityId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Activity_Close",
                new { ActivityId = activityId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ActivityErrors.IsKnown(ex.Number))
        {
            throw new ActivityException(ex.Number, ex.Message);
        }
    }
}
