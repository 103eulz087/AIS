namespace Akrho.Api.Features.Donations;

/// <summary>
/// IsInKind and InKindDescription are explicit fields — the client must NEVER infer
/// "in-kind" from Amount == 0 (a donation can carry both a cash amount and an in-kind
/// component at once; a client that assumed otherwise would misreport a mixed donation).
/// DonorType prefers the structured DonorType lookup name, falling back to the donation's
/// own free-text DonorType column when no structured type was recorded.
/// </summary>
public sealed record DonationListItemDto(
    int DonationId, int? ActivityId, string? ActivityName, DateOnly DonationDate, string DonorName,
    string? DonorType, decimal Amount, bool IsInKind, string? InKindDescription,
    string? ChapterReceiptNo, int RecordedBy, bool IsVoided);

public sealed record DonationVoidDto(int DonationVoidId, int VoidedBy, DateTime VoidedDateUtc, string Reason, int? ReversedLedgerEntryId);

public sealed record DonationDetailDto(
    int DonationId, int ChapterId, int? ActivityId, string? ActivityName, DateOnly DonationDate,
    string DonorName, string? DonorType, decimal Amount, bool IsInKind, string? InKindDescription,
    string? ChapterReceiptNo, int RecordedBy, bool IsVoided, IReadOnlyList<DonationVoidDto> VoidHistory);

/// <summary>
/// No DonationDate field — usp_Donation_Create always dates the donation to the day it is
/// recorded; there is no backdating parameter on that procedure and none is added here.
/// </summary>
public sealed record CreateDonationRequest(
    string DonorName, int? DonorTypeId, decimal? Amount, string? InKindDescription,
    string? ChapterReceiptNo, int? ActivityId, string? Notes);

public sealed record DonationCreatedDto(int DonationId, int? LedgerEntryId);

public sealed record VoidDonationRequest(string Reason);

public sealed record VoidDonationResponseDto(int DonationId, int? ReversedLedgerEntryId);

public sealed record DonationListRequest(
    int Skip = 0, int Take = 50, int? ActivityId = null,
    DateOnly? FromDate = null, DateOnly? ToDate = null, bool IncludeVoided = false);
