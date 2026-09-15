namespace Akrho.Api.Features.Expenses;

/// <summary>IsVoided is derived from the procedure's own IsDeleted flag — "voided", never "deleted", in any user-facing text.</summary>
public sealed record ExpenseListItemDto(
    int ExpenseId, int? ActivityId, string? ActivityName, DateOnly ExpenseDate, string Payee,
    string Description, decimal Amount, int? CategoryId, string? CategoryName,
    int RecordedBy, int? ApprovedBy, bool IsVoided);

/// <summary>
/// Display metadata only — no on-disk path. Re-downloading the bytes for an attachment
/// still staged goes through GET /api/attachments/{id}; once an attachment is claimed by an
/// expense it is not independently re-downloadable through this feature (out of scope for
/// this slice — see the accompanying report).
/// </summary>
public sealed record ExpenseAttachmentDto(int AttachmentId, string FileName, int FileSize, int UploadedBy);

public sealed record ExpenseVoidDto(int ExpenseVoidId, int VoidedBy, DateTime VoidedDateUtc, string Reason, int? ReversedLedgerEntryId);

public sealed record ExpenseDetailDto(
    int ExpenseId, int ChapterId, int? ActivityId, string? ActivityName, DateOnly ExpenseDate,
    string Payee, string Description, decimal Amount, int? CategoryId, string? CategoryName,
    int RecordedBy, int? ApprovedBy, bool IsVoided,
    IReadOnlyList<ExpenseAttachmentDto> Attachments, IReadOnlyList<ExpenseVoidDto> VoidHistory);

/// <summary>
/// AttachmentStagingIds are the ids returned by earlier POST /api/attachments calls — at
/// least one is required (docs §4.6: "receipt attachments (multiple, at least one
/// required)"); the procedure enforces this too, but the validator catches an empty
/// submission before the round trip.
/// </summary>
public sealed record CreateExpenseRequest(
    string Payee, decimal Amount, DateOnly ExpenseDate, int? CategoryId, int? ActivityId,
    string? Description, IReadOnlyList<int> AttachmentStagingIds);

public sealed record ExpenseCreatedDto(int ExpenseId, int LedgerEntryId);

public sealed record VoidExpenseRequest(string Reason);

public sealed record VoidExpenseResponseDto(int ExpenseId, int? ReversedLedgerEntryId);

public sealed record ExpenseListRequest(
    int Skip = 0, int Take = 50, int? ActivityId = null, int? CategoryId = null,
    DateOnly? FromDate = null, DateOnly? ToDate = null, bool IncludeVoided = false);
