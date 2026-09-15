using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum LedgerErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when a Ledger stored procedure rejects a call. Every message on these THROWs was
/// written in the procedure specifically to reach the officer reading the screen — surface
/// it plainly at the endpoint, never wrap it in something generic. Mirrors
/// <c>MeetingException</c>/<c>MeetingErrorCategory</c> in <c>MeetingRepository.cs</c> —
/// same shape, same reasoning, kept separate because the two feature sets have distinct
/// THROW number ranges.
/// </summary>
public sealed class LedgerException : Exception
{
    public LedgerErrorCategory Category { get; }

    public LedgerException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Ledger entry not found" — usp_Ledger_Reverse.
            51021 => LedgerErrorCategory.NotFound,

            // The entry's state changed under the caller (already reversed) — nothing
            // about the request itself was invalid.
            51022 => LedgerErrorCategory.Conflict,

            // Role/chapter checks the procedures enforce, in addition to IScopeGuard and
            // the endpoint's authorization policy (defence in depth). 51020 is
            // usp_Ledger_GetByChapter's own "not a member of this chapter" check; 51167 is
            // usp_Ledger_Reverse's "not Treasurer/Admin of this chapter" check.
            51020 or 51167 => LedgerErrorCategory.Forbidden,

            _ => LedgerErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the Ledger procs. Anything else — a
/// timeout, a deadlock, a dropped connection — is a real unexpected error and must NOT be
/// re-surfaced as a safe, human-authored message; it is left to propagate to the generic
/// 500 handler instead (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class LedgerErrors
{
    private static readonly HashSet<int> Known = [51020, 51021, 51022, 51167];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

public sealed record LedgerSummaryRow(decimal CashIn, decimal CashOut, decimal Balance);

public sealed record LedgerRow(
    int LedgerEntryId, DateTime EntryDate, string EntryType, decimal Amount,
    string Description, string SourceType, int? SourceId, int? ActivityId,
    string? ActivityName, bool IsReversal, int? ReversesEntryId,
    DateTime CreatedDate, int TotalCount);

public interface ILedgerRepository
{
    Task<IReadOnlyList<LedgerRow>> GetByChapterAsync(
        int requestingMemberId, int chapterId, DateOnly? from, DateOnly? to,
        int skip, int take, CancellationToken ct);

    /// <summary>
    /// The chapter's running fund balance and the two totals it's made of — computed in
    /// SQL over every entry, not by paging through the list client-side (which would be
    /// both wrong past one page and a duplicate of logic that belongs in one place).
    /// </summary>
    Task<LedgerSummaryRow> GetSummaryAsync(int requestingMemberId, int chapterId, CancellationToken ct);

    /// <summary>
    /// The only way to correct the ledger. There is deliberately no Update and no Delete
    /// on this interface — the table rejects both at the database level.
    /// </summary>
    /// <param name="requestingMemberId">
    /// The caller. usp_Ledger_Reverse now requires this and rejects the reversal unless
    /// the caller holds an active ChapterTreasurer or ChapterAdmin role in the SAME
    /// chapter the ledger entry belongs to (a scoping defect fix — this proc previously
    /// took no requester at all).
    /// </param>
    Task<int> ReverseAsync(int ledgerEntryId, string reason, int performedBy, int requestingMemberId, CancellationToken ct);
}

public sealed class LedgerRepository(ISqlConnectionFactory factory) : ILedgerRepository
{
    public async Task<IReadOnlyList<LedgerRow>> GetByChapterAsync(
        int requestingMemberId, int chapterId, DateOnly? from, DateOnly? to,
        int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<LedgerRow>(new CommandDefinition(
                "dbo.usp_Ledger_GetByChapter",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    ChapterId = chapterId,
                    FromDate = from?.ToDateTime(TimeOnly.MinValue),
                    ToDate = to?.ToDateTime(TimeOnly.MinValue),
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (LedgerErrors.IsKnown(ex.Number))
        {
            throw new LedgerException(ex.Number, ex.Message);
        }
    }

    public async Task<LedgerSummaryRow> GetSummaryAsync(int requestingMemberId, int chapterId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<LedgerSummaryRow>(new CommandDefinition(
                "dbo.usp_Ledger_GetSummary",
                new { RequestingMemberId = requestingMemberId, ChapterId = chapterId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (LedgerErrors.IsKnown(ex.Number))
        {
            throw new LedgerException(ex.Number, ex.Message);
        }
    }

    public async Task<int> ReverseAsync(int ledgerEntryId, string reason, int performedBy, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_Ledger_Reverse",
                new
                {
                    LedgerEntryId = ledgerEntryId,
                    Reason = reason,
                    PerformedBy = performedBy,
                    RequestingMemberId = requestingMemberId
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (LedgerErrors.IsKnown(ex.Number))
        {
            throw new LedgerException(ex.Number, ex.Message);
        }
    }
}
