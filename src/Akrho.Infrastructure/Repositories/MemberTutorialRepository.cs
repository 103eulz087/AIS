using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>
/// Thrown when usp_MemberTutorial_Finish rejects a call (51960-51963): an unknown tour, a
/// bad version or outcome, or a member who no longer exists. All are the caller's mistake,
/// so the endpoint answers 400 with the procedure's own message.
/// </summary>
public sealed class MemberTutorialException(int sqlErrorNumber, string message) : Exception(message)
{
    public int SqlErrorNumber { get; } = sqlErrorNumber;
}

internal static class MemberTutorialErrors
{
    public static bool IsKnown(int sqlErrorNumber) => sqlErrorNumber is >= 51960 and <= 51963;
}

/// <summary>One row of usp_MemberTutorial_GetMine — a tour the member has finished or skipped.</summary>
public sealed record MemberTutorialRow(string TourKey, int TourVersion, string Outcome, DateTime FinishedDate);

public interface IMemberTutorialRepository
{
    /// <summary>The caller's own finished/skipped tours (db/schema/31_member_tutorial.sql).</summary>
    Task<IReadOnlyList<MemberTutorialRow>> GetMineAsync(int memberId, CancellationToken ct);

    /// <summary>Records a finish or a skip. Throws <see cref="MemberTutorialException"/>.</summary>
    Task FinishAsync(int memberId, string tourKey, int tourVersion, string outcome, CancellationToken ct);
}

public sealed class MemberTutorialRepository(ISqlConnectionFactory factory) : IMemberTutorialRepository
{
    public async Task<IReadOnlyList<MemberTutorialRow>> GetMineAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<MemberTutorialRow>(new CommandDefinition(
            "dbo.usp_MemberTutorial_GetMine", new { MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.AsList();
    }

    public async Task FinishAsync(int memberId, string tourKey, int tourVersion, string outcome, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_MemberTutorial_Finish",
                new { MemberId = memberId, TourKey = tourKey, TourVersion = tourVersion, Outcome = outcome },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberTutorialErrors.IsKnown(ex.Number))
        {
            throw new MemberTutorialException(ex.Number, ex.Message);
        }
    }
}
