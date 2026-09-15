using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum DashboardErrorCategory { Forbidden, BadRequest }

/// <summary>
/// Thrown when usp_Dashboard_GetChapterSummary rejects a call. Mirrors
/// <c>LedgerException</c>/<c>LedgerErrorCategory</c> in <c>LedgerRepository.cs</c> — same
/// shape, same reasoning, kept separate because this is its own procedure with its own
/// THROW number.
/// </summary>
public sealed class DashboardException : Exception
{
    public DashboardErrorCategory Category { get; }

    public DashboardException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // The procedure's only THROW — the caller is not an undeleted member of
            // @ChapterId. See usp_Dashboard_GetChapterSummary.sql.
            51258 => DashboardErrorCategory.Forbidden,

            // Unreachable today (DashboardErrors.IsKnown only ever lets 51258 through),
            // but kept so the switch stays exhaustive if a second THROW is ever added,
            // the same way MeetingErrorCategory/LedgerErrorCategory do it.
            _ => DashboardErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by usp_Dashboard_GetChapterSummary.
/// Anything else — a timeout, a deadlock, a dropped connection — is a real unexpected
/// error and must NOT be re-surfaced as a safe, human-authored message; it is left to
/// propagate to the generic 500 handler instead (CLAUDE.md: never leak an exception
/// message to the client).
/// </summary>
internal static class DashboardErrors
{
    private static readonly HashSet<int> Known = [51258];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// Result set 1 — derived from dbo.LedgerEntry only. Period figures and the all-time
/// current balance are both always present so a caller can never mistake one for the
/// other (see the procedure's own header comment).
/// </summary>
public sealed record DashboardFinancialRow(
    decimal OpeningBalance, decimal PeriodIn, decimal PeriodOut, decimal ClosingBalance,
    decimal CurrentBalance, decimal InFromMeetings, decimal InFromDonations, decimal InOther,
    decimal OutOnExpenses, decimal OutOther);

/// <summary>
/// Result set 2 — headcounts by dbo.MemberStatus, plus NewThisPeriod. Six status buckets,
/// not four — Pending/Approved/Active/Inactive/Suspended/Rejected — so Total always
/// reconciles against the sum of the six.
/// </summary>
public sealed record DashboardMembershipRow(
    int Total, int Pending, int Approved, int Active, int Inactive, int Suspended, int Rejected,
    int NewThisPeriod);

/// <summary>
/// Result set 3 — attendance as a headcount first ("N present of M on the sheet"), never
/// broken down per member. AveragePresentPerMeeting is a chapter-wide mean, never a
/// collection/arrears figure (CLAUDE.md invariant #5).
/// </summary>
public sealed record DashboardActivityRow(
    int MeetingsHeld, int TotalPresent, int TotalOnSheets, decimal AveragePresentPerMeeting);

/// <summary>
/// One row of result set 4 — a count by corrective-action status, never a case list,
/// never a member name (CLAUDE.md invariant #6). Always exactly four rows: Pending,
/// Under Review, Reconciled, Dismissed — zero-filled, never omitted.
/// </summary>
public sealed record CorrectiveActionStatusCountRow(string StatusName, int CaseCount);

public sealed record DashboardSummaryRows(
    DashboardFinancialRow Financial,
    DashboardMembershipRow Membership,
    DashboardActivityRow Activity,
    IReadOnlyList<CorrectiveActionStatusCountRow> CorrectiveActionCounts);

public interface IDashboardRepository
{
    /// <summary>
    /// Throws <see cref="DashboardException"/> (Forbidden) if the caller is not an
    /// undeleted member of <paramref name="chapterId"/>. @FromDate/@ToDate are required by
    /// the procedure — the caller (the endpoint) must already have resolved any default
    /// (the current membership year) before calling this.
    /// </summary>
    Task<DashboardSummaryRows> GetChapterSummaryAsync(
        int chapterId, int requestingMemberId, DateOnly fromDate, DateOnly toDate, CancellationToken ct);
}

public sealed class DashboardRepository(ISqlConnectionFactory factory) : IDashboardRepository
{
    public async Task<DashboardSummaryRows> GetChapterSummaryAsync(
        int chapterId, int requestingMemberId, DateOnly fromDate, DateOnly toDate, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_Dashboard_GetChapterSummary",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    FromDate = fromDate.ToDateTime(TimeOnly.MinValue),
                    ToDate = toDate.ToDateTime(TimeOnly.MinValue)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var financial = await multi.ReadSingleAsync<DashboardFinancialRow>();
            var membership = await multi.ReadSingleAsync<DashboardMembershipRow>();
            var activity = await multi.ReadSingleAsync<DashboardActivityRow>();
            var correctiveActionCounts = (await multi.ReadAsync<CorrectiveActionStatusCountRow>()).ToList();

            return new DashboardSummaryRows(financial, membership, activity, correctiveActionCounts);
        }
        catch (SqlException ex) when (DashboardErrors.IsKnown(ex.Number))
        {
            throw new DashboardException(ex.Number, ex.Message);
        }
    }
}
