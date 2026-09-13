using System.Data;
using Dapper;

namespace Akrho.Infrastructure.Repositories;

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
    /// The only way to correct the ledger. There is deliberately no Update and no Delete
    /// on this interface — the table rejects both at the database level.
    /// </summary>
    Task<int> ReverseAsync(int ledgerEntryId, string reason, int performedBy, CancellationToken ct);
}

public sealed class LedgerRepository(ISqlConnectionFactory factory) : ILedgerRepository
{
    public async Task<IReadOnlyList<LedgerRow>> GetByChapterAsync(
        int requestingMemberId, int chapterId, DateOnly? from, DateOnly? to,
        int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
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

    public async Task<int> ReverseAsync(int ledgerEntryId, string reason, int performedBy, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "dbo.usp_Ledger_Reverse",
            new { LedgerEntryId = ledgerEntryId, Reason = reason, PerformedBy = performedBy },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }
}
