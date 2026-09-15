using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum DonationErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when a Donation stored procedure rejects a call. Same pattern as
/// <see cref="ExpenseException"/> — Donation and Expense sit in adjacent THROW-number
/// ranges but are kept as two distinct exception types, one per feature folder, matching
/// the split already established between Meetings and Ledger.
/// </summary>
public sealed class DonationException : Exception
{
    public DonationErrorCategory Category { get; }

    public DonationException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Donation not found" — same message for a nonexistent id and a wrong-chapter
            // caller (usp_Donation_Get, usp_Donation_Void). Anti-enumeration.
            51206 or 51211 => DonationErrorCategory.NotFound,

            // Already voided.
            51207 => DonationErrorCategory.Conflict,

            // Role/chapter checks the procedure itself enforces (defence in depth).
            51202 or 51209 or 51210 => DonationErrorCategory.Forbidden,

            // Neither cash nor in-kind, an unrecognised donor type/activity, or a void
            // reason under 10 characters.
            51203 or 51204 or 51205 or 51208 => DonationErrorCategory.BadRequest,

            _ => DonationErrorCategory.BadRequest
        };
    }
}

internal static class DonationErrors
{
    private static readonly HashSet<int> Known =
        Enumerable.Range(51202, 51211 - 51202 + 1).ToHashSet();

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// Amount is 0 for a pure in-kind donation — IsInKind (derived from InKindDescription, NOT
/// from Amount == 0) is what the endpoint layer must use to decide the DTO shape; never let
/// a client infer "in-kind" from a zero amount (this proc's own header comment: no per-donor
/// aggregation, ever — the same hard line applies here as usp_Donation_GetByChapter).
/// </summary>
public sealed record DonationListRow(
    int DonationId, int? ActivityId, string? ActivityName, DateTime DonationDate, string DonorName,
    string? DonorType, int? DonorTypeId, string? TypeName, string? Subject, string? Body,
    decimal Amount, string? InKindDescription, string? ChapterReceiptNo, int RecordedBy,
    bool IsVoided, int TotalCount);

public sealed record DonationHeaderRow(
    int DonationId, int ChapterId, int? ActivityId, string? ActivityName, DateTime DonationDate,
    string DonorName, string? DonorType, int? DonorTypeId, string? TypeName, string? Subject, string? Body,
    decimal Amount, string? InKindDescription, string? ChapterReceiptNo, int RecordedBy, bool IsVoided);

public sealed record DonationVoidRow(int DonationVoidId, int VoidedBy, DateTime VoidedDate, string Reason, int? ReversedLedgerEntryId);

public sealed record DonationDetailRows(DonationHeaderRow Header, IReadOnlyList<DonationVoidRow> VoidHistory);

/// <summary>LedgerEntryId is NULL for a pure in-kind donation — nothing was posted.</summary>
public sealed record CreateDonationResultRow(int DonationId, int? LedgerEntryId);

/// <summary>ReversedLedgerEntryId is NULL when the donation was in-kind — nothing to reverse.</summary>
public sealed record VoidDonationResultRow(int DonationId, int? ReversedLedgerEntryId);

public interface IDonationRepository
{
    /// <summary>Throws <see cref="DonationException"/> (Forbidden / BadRequest).</summary>
    Task<CreateDonationResultRow> CreateAsync(
        int chapterId, int requestingMemberId, string donorName, int? donorTypeId, decimal? amount,
        string? inKindDescription, string? chapterReceiptNo, int? activityId, string? notes,
        CancellationToken ct);

    /// <summary>
    /// Never add a donor-scoped filter or an aggregate to this method — see
    /// usp_Donation_GetByChapter's header comment. Donations aggregate by activity and by
    /// chapter only.
    /// </summary>
    Task<IReadOnlyList<DonationListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take,
        int? activityId, DateOnly? fromDate, DateOnly? toDate, bool includeVoided,
        CancellationToken ct);

    /// <summary>Throws <see cref="DonationException"/> (NotFound) — same message for a bad id or a wrong chapter.</summary>
    Task<DonationDetailRows> GetAsync(int donationId, int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="DonationException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task<VoidDonationResultRow> VoidAsync(int donationId, string reason, int requestingMemberId, CancellationToken ct);
}

public sealed class DonationRepository(ISqlConnectionFactory factory) : IDonationRepository
{
    public async Task<CreateDonationResultRow> CreateAsync(
        int chapterId, int requestingMemberId, string donorName, int? donorTypeId, decimal? amount,
        string? inKindDescription, string? chapterReceiptNo, int? activityId, string? notes,
        CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<CreateDonationResultRow>(new CommandDefinition(
                "dbo.usp_Donation_Create",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    DonorName = donorName,
                    DonorTypeId = donorTypeId,
                    Amount = amount ?? 0m,
                    InKindDescription = inKindDescription,
                    ChapterReceiptNo = chapterReceiptNo,
                    ActivityId = activityId,
                    Notes = notes
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (DonationErrors.IsKnown(ex.Number))
        {
            throw new DonationException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<DonationListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take,
        int? activityId, DateOnly? fromDate, DateOnly? toDate, bool includeVoided,
        CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<DonationListRow>(new CommandDefinition(
                "dbo.usp_Donation_GetByChapter",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500),
                    ActivityId = activityId,
                    FromDate = fromDate.HasValue ? fromDate.Value.ToDateTime(TimeOnly.MinValue) : (DateTime?)null,
                    ToDate = toDate.HasValue ? toDate.Value.ToDateTime(TimeOnly.MinValue) : (DateTime?)null,
                    IncludeVoided = includeVoided
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (DonationErrors.IsKnown(ex.Number))
        {
            throw new DonationException(ex.Number, ex.Message);
        }
    }

    public async Task<DonationDetailRows> GetAsync(int donationId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_Donation_Get",
                new { DonationId = donationId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<DonationHeaderRow>();
            var voidHistory = (await multi.ReadAsync<DonationVoidRow>()).ToList();

            return new DonationDetailRows(header, voidHistory);
        }
        catch (SqlException ex) when (DonationErrors.IsKnown(ex.Number))
        {
            throw new DonationException(ex.Number, ex.Message);
        }
    }

    public async Task<VoidDonationResultRow> VoidAsync(int donationId, string reason, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<VoidDonationResultRow>(new CommandDefinition(
                "dbo.usp_Donation_Void",
                new { DonationId = donationId, Reason = reason, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (DonationErrors.IsKnown(ex.Number))
        {
            throw new DonationException(ex.Number, ex.Message);
        }
    }
}
