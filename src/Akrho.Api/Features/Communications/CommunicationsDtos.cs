namespace Akrho.Api.Features.Communications;

/// <summary>
/// One announcement, everyone's shape — there is no restricted second view for
/// announcements the way there is for CorrectiveActionDto; the body is public to the whole
/// chapter by design (short, time-sensitive, never disciplinary content).
/// </summary>
public sealed record AnnouncementDto(
    int AnnouncementId, string Title, string Body, bool IsUrgent,
    int? UrgentTypeId, string? UrgentTypeName, int? BloodTypeId, string? BloodTypeName,
    DateTime PublishDateUtc, DateOnly? ExpiryDate, int CreatedBy,
    int? EditedBy, DateTime? EditedDateUtc,
    bool IsWithdrawn, int? WithdrawnBy, DateTime? WithdrawnDateUtc, string? WithdrawnReason,
    bool HasRead);

public sealed record CreateAnnouncementRequest(
    string Title, string Body, bool IsUrgent, int? UrgentTypeId, int? BloodTypeId, DateOnly? ExpiryDate);

public sealed record EditAnnouncementRequest(
    string Title, string Body, bool IsUrgent, int? UrgentTypeId, int? BloodTypeId, DateOnly? ExpiryDate);

public sealed record WithdrawAnnouncementRequest(string Reason);

public sealed record AnnouncementCreatedDto(int AnnouncementId);

/// <summary>
/// IncludeWithdrawn defaults to false — the ordinary member feed. An officer view that wants
/// to confirm a withdrawal went through (or review the "Withdrawn — reason" history) passes
/// true; usp_Announcement_GetForMember does not gate that behind a role check because it is
/// still a read, not a write, and the withdrawn reason carries no more sensitivity than the
/// announcement body itself did.
/// </summary>
public sealed record AnnouncementListRequest(int Skip = 0, int Take = 50, bool IncludeWithdrawn = false);

/// <summary>
/// One memo. "Subject" mirrors usp_Memo_Publish's own @Subject parameter name (the underlying
/// column is Title, shared with Announcement — the API surface uses the vocabulary the
/// procedure itself uses for this document type).
/// </summary>
public sealed record MemoDto(
    int MemoId, string MemoNumber, string Subject, string Body, DateTime PublishDateUtc, int CreatedBy,
    int? SupersedesMemoId, bool IsSuperseded, int? SupersededByMemoId, string? SupersededByMemoNumber,
    bool HasRead);

public sealed record PublishMemoRequest(string Subject, string Body, int? SupersedesMemoId);

public sealed record MemoPublishedDto(int MemoId, string MemoNumber);

public sealed record MemoListRequest(int Skip = 0, int Take = 50);

/// <summary>
/// One reader of a document. GiftName + FullName mirrors how MemberDto shapes a same-chapter
/// name elsewhere in this codebase (MembersEndpoints.cs) rather than exposing FirstName/
/// LastName separately — this endpoint is already officer-gated, so there is no privacy
/// reason to prefer the split form here either.
/// </summary>
public sealed record ReadReceiptDto(int MemberId, string GiftName, string FullName, DateTime ReadDateUtc);
