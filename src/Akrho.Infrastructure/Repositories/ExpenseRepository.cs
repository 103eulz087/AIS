using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum ExpenseErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when an Expense stored procedure rejects a call. Same pattern as
/// <see cref="MeetingException"/> — every message was written in the procedure to reach
/// the officer reading the screen; surface it plainly, never wrap it in something generic.
/// </summary>
public sealed class ExpenseException : Exception
{
    public ExpenseErrorCategory Category { get; }

    public ExpenseException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Expense not found" / "Attachment not found" — thrown identically for a
            // nonexistent id and for a wrong-chapter caller (usp_Expense_Get,
            // usp_Expense_Void, usp_ExpenseAttachment_GetForDownload). Anti-enumeration.
            51196 or 51201 or 51215 => ExpenseErrorCategory.NotFound,

            // Already voided — the resource's own state changed under the caller, nothing
            // about the request itself was invalid.
            51197 => ExpenseErrorCategory.Conflict,

            // Role/chapter checks the procedure itself enforces (defence in depth alongside
            // ChapterMoneyWrite / ChapterMoneyVoid and IScopeGuard).
            51190 or 51199 or 51200 => ExpenseErrorCategory.Forbidden,

            // A malformed payload: non-positive amount, no attachment, unrecognised
            // category/activity, a staged attachment that is missing/consumed/foreign, or
            // a void reason under 10 characters.
            51191 or 51192 or 51193 or 51194 or 51195 or 51198 => ExpenseErrorCategory.BadRequest,

            _ => ExpenseErrorCategory.BadRequest
        };
    }
}

/// <summary>The complete set of custom THROW numbers used by the Expense procs.</summary>
internal static class ExpenseErrors
{
    private static readonly HashSet<int> Known =
        Enumerable.Range(51190, 51201 - 51190 + 1).Append(51215).ToHashSet();

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

public sealed record ExpenseListRow(
    int ExpenseId, int? ActivityId, string? ActivityName, DateTime ExpenseDate, string Payee,
    string Description, decimal Amount, int? CategoryId, string? CategoryName,
    int RecordedBy, int? ApprovedBy, bool IsDeleted, int TotalCount);

public sealed record ExpenseHeaderRow(
    int ExpenseId, int ChapterId, int? ActivityId, string? ActivityName, DateTime ExpenseDate,
    string Payee, string Description, decimal Amount, int? CategoryId, string? CategoryName,
    int RecordedBy, int? ApprovedBy, bool IsDeleted);

/// <summary>
/// FilePath is deliberately NOT surfaced past the repository layer — the endpoint maps this
/// row to a client DTO that carries no on-disk path, only display metadata. Downloading the
/// underlying bytes (while still staged) goes through GET /api/attachments/{id} instead.
/// </summary>
public sealed record ExpenseAttachmentRow(int AttachmentId, string FilePath, string FileName, int FileSize, int UploadedBy);

/// <summary>Same FilePath-stays-in-the-repository-layer posture as <see cref="ExpenseAttachmentRow"/>.</summary>
public sealed record ExpenseAttachmentDownloadRow(string FilePath, string FileName, string? ContentType);

public sealed record ExpenseVoidRow(int ExpenseVoidId, int VoidedBy, DateTime VoidedDate, string Reason, int? ReversedLedgerEntryId);

public sealed record ExpenseDetailRows(
    ExpenseHeaderRow Header,
    IReadOnlyList<ExpenseAttachmentRow> Attachments,
    IReadOnlyList<ExpenseVoidRow> VoidHistory);

public sealed record CreateExpenseResultRow(int ExpenseId, int LedgerEntryId);

public sealed record VoidExpenseResultRow(int ExpenseId, int? ReversedLedgerEntryId);

public interface IExpenseRepository
{
    /// <summary>Throws <see cref="ExpenseException"/> (Forbidden / BadRequest).</summary>
    Task<CreateExpenseResultRow> CreateAsync(
        int chapterId, int requestingMemberId, string payee, decimal amount, DateOnly expenseDate,
        int? categoryId, int? activityId, string? description, IReadOnlyList<int> attachmentStagingIds,
        CancellationToken ct);

    Task<IReadOnlyList<ExpenseListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take,
        int? activityId, int? categoryId, DateOnly? fromDate, DateOnly? toDate, bool includeVoided,
        CancellationToken ct);

    /// <summary>Throws <see cref="ExpenseException"/> (NotFound) — same message for a bad id or a wrong chapter.</summary>
    Task<ExpenseDetailRows> GetAsync(int expenseId, int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="ExpenseException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task<VoidExpenseResultRow> VoidAsync(int expenseId, string reason, int requestingMemberId, CancellationToken ct);

    /// <summary>
    /// Resolves an already-attached receipt for download through the expense that owns it.
    /// dbo.ExpenseAttachment.AttachmentId is a different id space from
    /// dbo.AttachmentStaging.AttachmentStagingId — this is NOT the same lookup as
    /// GET /api/attachments/{id}. Throws <see cref="ExpenseException"/> (NotFound) — same
    /// message for a bad expense id, a bad attachment id, an attachment belonging to a
    /// different expense, or a wrong-chapter caller.
    /// </summary>
    Task<ExpenseAttachmentDownloadRow> GetAttachmentForDownloadAsync(
        int expenseId, int attachmentId, int requestingMemberId, CancellationToken ct);
}

public sealed class ExpenseRepository(ISqlConnectionFactory factory) : IExpenseRepository
{
    public async Task<CreateExpenseResultRow> CreateAsync(
        int chapterId, int requestingMemberId, string payee, decimal amount, DateOnly expenseDate,
        int? categoryId, int? activityId, string? description, IReadOnlyList<int> attachmentStagingIds,
        CancellationToken ct)
    {
        var table = new DataTable();
        table.Columns.Add("Value", typeof(int));
        foreach (var id in attachmentStagingIds) table.Rows.Add(id);

        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<CreateExpenseResultRow>(new CommandDefinition(
                "dbo.usp_Expense_Create",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Payee = payee,
                    Amount = amount,
                    ExpenseDate = expenseDate.ToDateTime(TimeOnly.MinValue),
                    CategoryId = categoryId,
                    ActivityId = activityId,
                    Description = description,
                    AttachmentStagingIds = table.AsTableValuedParameter("dbo.IntList")
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ExpenseErrors.IsKnown(ex.Number))
        {
            throw new ExpenseException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ExpenseListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take,
        int? activityId, int? categoryId, DateOnly? fromDate, DateOnly? toDate, bool includeVoided,
        CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ExpenseListRow>(new CommandDefinition(
                "dbo.usp_Expense_GetByChapter",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500),
                    ActivityId = activityId,
                    CategoryId = categoryId,
                    FromDate = fromDate.HasValue ? fromDate.Value.ToDateTime(TimeOnly.MinValue) : (DateTime?)null,
                    ToDate = toDate.HasValue ? toDate.Value.ToDateTime(TimeOnly.MinValue) : (DateTime?)null,
                    IncludeVoided = includeVoided
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (ExpenseErrors.IsKnown(ex.Number))
        {
            throw new ExpenseException(ex.Number, ex.Message);
        }
    }

    public async Task<ExpenseDetailRows> GetAsync(int expenseId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_Expense_Get",
                new { ExpenseId = expenseId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<ExpenseHeaderRow>();
            var attachments = (await multi.ReadAsync<ExpenseAttachmentRow>()).ToList();
            var voidHistory = (await multi.ReadAsync<ExpenseVoidRow>()).ToList();

            return new ExpenseDetailRows(header, attachments, voidHistory);
        }
        catch (SqlException ex) when (ExpenseErrors.IsKnown(ex.Number))
        {
            throw new ExpenseException(ex.Number, ex.Message);
        }
    }

    public async Task<VoidExpenseResultRow> VoidAsync(int expenseId, string reason, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<VoidExpenseResultRow>(new CommandDefinition(
                "dbo.usp_Expense_Void",
                new { ExpenseId = expenseId, Reason = reason, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ExpenseErrors.IsKnown(ex.Number))
        {
            throw new ExpenseException(ex.Number, ex.Message);
        }
    }

    public async Task<ExpenseAttachmentDownloadRow> GetAttachmentForDownloadAsync(
        int expenseId, int attachmentId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ExpenseAttachmentDownloadRow>(new CommandDefinition(
                "dbo.usp_ExpenseAttachment_GetForDownload",
                new { ExpenseId = expenseId, AttachmentId = attachmentId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ExpenseErrors.IsKnown(ex.Number))
        {
            throw new ExpenseException(ex.Number, ex.Message);
        }
    }
}
