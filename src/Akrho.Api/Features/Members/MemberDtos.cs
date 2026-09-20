namespace Akrho.Api.Features.Members;

/// <summary>Full member record. Returned only to members of the SAME chapter.</summary>
public sealed record MemberDto(
    int MemberId, string GiftName, string MemberNumber, int ChapterId, string ChapterName,
    string Status, string? FullName, string? MobileNo, string? Profession,
    string? BloodType, string? PhotoUrl, DateOnly? RenewedThrough, bool IsCurrent);

/// <summary>
/// Cross-chapter shape. Client decision: name, chapter and status ONLY.
/// The other fields are ABSENT, not empty — absent is safe, empty invites a later
/// refactor to "just fill them in".
/// </summary>
public sealed record MemberCrossChapterDto(
    int MemberId, string GiftName, int ChapterId, string ChapterName, string Status);

/// <summary>
/// A THIRD shape, alongside <see cref="MemberDto"/> and <see cref="MemberCrossChapterDto"/>
/// above — a member's own profile. Not a privacy relaxation: those two restrict what OTHER
/// members may see of him (CLAUDE.md invariant #7); this is what he may see of HIMSELF, which
/// is necessarily more permissive (Address, Email, DateSurvive, approval provenance, etc. —
/// none of which the directory ever hands to anyone, including a same-chapter brother). It is
/// never returned for any MemberId other than the caller's own — see GET /api/members/me.
/// Read-only identity/organizational fields sit alongside the self-editable ones (MobileNo,
/// Email, Address, Profession, BloodType*, SkillIds) — see PATCH /api/members/me for which of
/// these the member may actually change.
/// </summary>
public sealed record MemberProfileDto(
    int MemberId, string MemberNumber,
    string FirstName, string? MiddleName, string LastName, string GiftName,
    DateOnly? Birthdate,
    DateOnly? DateSurvive, string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    int? ChapterId, string? ChapterName,
    int? HomeCouncilId, string? CouncilName,
    string? ChapterOfRecord,
    string Status,
    DateOnly? RenewedThrough,
    int? SeconderMemberId, int? ApprovedBy, DateTime? ApprovedDateUtc,
    string? Address, string? MobileNo, string? Email,
    int? BloodTypeId, string? BloodTypeName, DateTime? BloodTypeConfirmedDateUtc,
    string? Profession,
    string? PhotoUrl,
    IReadOnlyList<int> SkillIds,
    byte[] RowVersion);

/// <summary>
/// PATCH /api/members/me. RowVersion is whatever the last GET /api/members/me call returned —
/// the concurrency guard lives in usp_Member_UpdateOwnProfile's own UPDATE WHERE clause, not
/// here. CurrentPassword is optional at the DTO level; whether it is actually REQUIRED depends
/// on whether MobileNo is really changing — see the handler for exactly how that is decided
/// (GiftName/BirthDate/DateSurvive/PresidentDuringSurvive/MasterInitiatorDuringSurvive changes
/// never require it — only MobileNo is security-relevant, since it is how the account is
/// reached/recovered). BloodTypeConfirmed is never described as "verified" anywhere in this
/// codebase — it is a self-report, confirmed on a date, full stop (docs §8).
/// </summary>
public sealed record UpdateMemberProfileRequest(
    string GiftName, DateOnly? BirthDate, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string MobileNo, string? Email, string? Address,
    int? BloodTypeId, bool BloodTypeConfirmed, string? Profession,
    IReadOnlyList<int> SkillIds,
    byte[] RowVersion,
    string? CurrentPassword);

/// <summary>The new RowVersion, so the client can keep editing without a refetch.</summary>
public sealed record MemberProfileUpdatedDto(byte[] RowVersion);

/// <summary>POST /api/members/me/photo — claims an already-staged upload as the caller's own photo.</summary>
public sealed record ClaimMemberPhotoRequest(int AttachmentStagingId);

public sealed record MemberPhotoClaimedDto(string PhotoUrl);

/// <summary>POST /api/members/me/photo/stage — the id to pass into a following POST /api/members/me/photo.</summary>
public sealed record MemberPhotoStagedDto(int AttachmentStagingId);

/// <summary>
/// StatusId (optional) filters to one exact MemberStatus — lets a dashboard tile like
/// "Inactive: 7" link straight to GET /api/members?chapterId=1&amp;statusId=4 instead of a
/// dead-end number. Same gate as today applies underneath it: drilling into a non-Approved/
/// Active status still needs IncludeInactive=true alongside StatusId
/// (see usp_Member_Search.sql).
/// </summary>
public sealed record MemberSearchRequest(
    int? ChapterId = null, string? Search = null, int? BloodTypeId = null,
    int? SkillId = null, bool IncludeInactive = false, int? StatusId = null,
    int Skip = 0, int Take = 50);

/// <summary>
/// POST /api/members/{id}/enrolment-link — a Chapter Admin re-issuing access for a member of
/// his own chapter who forgot his password. SHOW-ONCE, same as
/// ApproveMembershipApplicationResponseDto: this is the only response that will ever carry
/// EnrolmentUrl's raw token. A lost link means the admin issues another fresh one.
/// </summary>
public sealed record ReissueMemberEnrolmentLinkResponseDto(int MemberId, string EnrolmentUrl, DateTime ExpiresOnUtc);

/// <summary>POST /api/members/{memberId}/block and /unblock — National Council only.
/// Reason is required and recorded in dbo.MemberAccountAction, kept out of
/// dbo.CorrectiveAction (client decision 2026-09-21 — blocking a login is not the same
/// act as disciplining a member).</summary>
public sealed record MemberAccountActionRequest(string Reason);

/// <summary>Response for both block and unblock — a plain acknowledgement, nothing to
/// show-once here (unlike a reset, which hands back a link).</summary>
public sealed record MemberAccountActionResultDto(int MemberId, string Action);

/// <summary>
/// POST /api/members/{memberId}/reset-password — National Council only. SHOW-ONCE, same
/// convention as ReissueMemberEnrolmentLinkResponseDto: this is the only response that
/// will ever carry EnrolmentUrl's raw token. Never a password — CLAUDE.md invariant #16.
/// </summary>
public sealed record MemberPasswordResetDto(int MemberId, string EnrolmentUrl, DateTime ExpiresOnUtc);

/// <summary>GET /api/members/blocked — National Council only. One row per currently-
/// blocked member (dbo.MemberAccountAction's own most-recent-action derivation, not
/// dbo.UserAccount.IsDisabled directly — a member blocked before his first enrolment has
/// no UserAccount row yet and must still appear here).</summary>
public sealed record BlockedMemberDto(
    int MemberId, string GiftName, string MemberNumber, string? ChapterName,
    string Reason, DateTime PerformedDateUtc, string? BlockedByGiftName);
