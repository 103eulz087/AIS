using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>
/// Thrown when usp_CouncilStatistics_Get rejects a call — either the caller holds no
/// council seat at all (51620), or holds one but not over the requested
/// <c>@FocusCouncilId</c> (51621). Both are surfaced at the endpoint layer as 403: the
/// caller is authenticated and the route exists, he simply lacks standing for this
/// specific view.
/// </summary>
public sealed class CouncilStatisticsException(string message) : Exception(message);

/// <summary>
/// The complete set of custom THROW numbers used by usp_CouncilStatistics_Get. Anything
/// else — a timeout, a deadlock, a dropped connection — is a real unexpected error and
/// must NOT be re-surfaced as a safe, human-authored message (CLAUDE.md: never leak an
/// exception message to the client).
/// </summary>
internal static class CouncilStatisticsErrors
{
    public const int NoCouncilSeat = 51620;
    public const int OutsideJurisdiction = 51621;

    private static readonly HashSet<int> Known = [NoCouncilSeat, OutsideJurisdiction];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// One council rolled up over its own entire subtree. Set 1 (the focus council, a single
/// row) and Set 2 (each of its direct child councils) share this EXACT shape — see
/// usp_CouncilStatistics_Get's own header. Every figure here is a count or an average,
/// never a member-identifying detail and never an "amount owed" (CLAUDE.md invariant #5).
/// </summary>
public sealed record CouncilRollupRow(
    int CouncilId, string CouncilName, string LevelName, int? ParentCouncilId, int Depth,
    bool HasSeatedOfficers, int DirectChildCouncilCount, int TotalCouncilsInSubtree,
    int DirectChapterCount, int TotalChaptersInSubtree, int ActiveChapterCount, int InactiveChapterCount,
    int MemberTotal, int MemberPending, int MemberApproved, int MemberActive, int MemberInactive,
    int MemberSuspended, int MemberRejected, int NewThisPeriod, int DetachedMemberCount,
    int RenewedCount, int LapsedCount, int ExemptCount, int NotRecordedCount, bool HasRenewalData,
    int RegSubmittedCount, int RegReturnedForCorrectionCount, int RegApprovedCount,
    int MeetingsHeld, int TotalPresent, int TotalOnSheets, decimal AveragePresentPerMeeting);

/// <summary>
/// Set 3 — one row per chapter in the focus council's entire subtree (not just direct
/// children), paged. <see cref="TotalCount"/> is the same <c>COUNT(*) OVER()</c> value on
/// every row of the page, read once by the caller for pagination. Money fields are
/// <c>decimal</c> — never <c>double</c>/<c>float</c> (CLAUDE.md hard rule) — and there is no
/// "amount owed" field anywhere (CLAUDE.md invariant #5: contributions are voluntary).
/// </summary>
public sealed record ChapterStatisticsRow(
    int ChapterId, string ChapterName, string? Barangay, int ParentCouncilId, string ParentCouncilName,
    bool IsActive, int MemberTotal, int MemberPending, int MemberApproved, int MemberActive,
    int MemberInactive, int MemberSuspended, int MemberRejected, int NewThisPeriod,
    int RenewedCount, int LapsedCount, int ExemptCount, int NotRecordedCount, bool HasRenewalData,
    int MeetingsHeld, int TotalPresent, int TotalOnSheets, decimal AveragePresentPerMeeting,
    decimal OpeningBalance, decimal PeriodIn, decimal PeriodOut, decimal ClosingBalance,
    int CaseCountPending, int CaseCountUnderReview, int CaseCountReconciled, int CaseCountDismissed,
    int TotalCount);

/// <summary>The four result sets, read in the exact order usp_CouncilStatistics_Get returns them.</summary>
public sealed record CouncilStatisticsRows(
    CouncilRollupRow Focus,
    IReadOnlyList<CouncilRollupRow> ChildCouncils,
    IReadOnlyList<ChapterStatisticsRow> Chapters,
    IReadOnlyList<CorrectiveActionStatusCountRow> CorrectiveActionTotals);

public interface ICouncilStatisticsRepository
{
    /// <summary>
    /// <paramref name="focusCouncilId"/> NULL means "the caller's own seat" — resolved
    /// entirely inside the procedure from <paramref name="requestingMemberId"/>, never
    /// guessed here (CLAUDE.md invariant #4/#11). Throws
    /// <see cref="CouncilStatisticsException"/> if the caller holds no council seat at all,
    /// or holds one but not over the requested council.
    /// </summary>
    Task<CouncilStatisticsRows> GetAsync(
        int requestingMemberId, int? focusCouncilId, DateOnly fromDate, DateOnly toDate,
        int skip, int take, CancellationToken ct);
}

public sealed class CouncilStatisticsRepository(ISqlConnectionFactory factory) : ICouncilStatisticsRepository
{
    public async Task<CouncilStatisticsRows> GetAsync(
        int requestingMemberId, int? focusCouncilId, DateOnly fromDate, DateOnly toDate,
        int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_CouncilStatistics_Get",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    FocusCouncilId = focusCouncilId,
                    FromDate = fromDate.ToDateTime(TimeOnly.MinValue),
                    ToDate = toDate.ToDateTime(TimeOnly.MinValue),
                    Skip = skip,
                    Take = take
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var focus = await multi.ReadSingleAsync<CouncilRollupRow>();
            var childCouncils = (await multi.ReadAsync<CouncilRollupRow>()).ToList();
            var chapters = (await multi.ReadAsync<ChapterStatisticsRow>()).ToList();
            var correctiveActionTotals = (await multi.ReadAsync<CorrectiveActionStatusCountRow>()).ToList();

            return new CouncilStatisticsRows(focus, childCouncils, chapters, correctiveActionTotals);
        }
        catch (SqlException ex) when (CouncilStatisticsErrors.IsKnown(ex.Number))
        {
            throw new CouncilStatisticsException(ex.Message);
        }
    }
}
