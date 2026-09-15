namespace Akrho.Api.Features.MembershipApplications;

/// <summary>
/// The public, short-form sign-up. No photo, no username, no blood type/skills/profession/
/// address — those are later, authenticated concerns (see db/schema/10_membership_applications.sql
/// design notes). ChapterId is the applicant's OWN stated choice here, unlike everywhere else
/// in this codebase where a chapterId in the body is never trusted — there is no caller
/// identity yet to check it against; usp_MembershipApplication_Submit validates it is a real,
/// active chapter, nothing more.
/// </summary>
public sealed record SubmitMembershipApplicationRequest(
    int ChapterId, string FirstName, string? MiddleName, string LastName, string GiftName,
    DateOnly BirthDate, string MobileNo, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string SeconderNameGiven, string? SeconderMemberNumberGiven);

public sealed record SubmitMembershipApplicationResponseDto(string ReferenceNo);

/// <summary>
/// The "check my application" and "resubmit" identification pair. BOTH must match the same
/// row; a wrong reference and a wrong mobile number produce the identical 404 (see
/// usp_MembershipApplication_GetByReference's own header comment) — never differentiate them.
/// </summary>
public sealed record MembershipApplicationIdentifyQuery(string ReferenceNo, string MobileNo);

/// <summary>The applicant's own view of his application's current state.</summary>
public sealed record MembershipApplicationStatusDto(
    string ReferenceNo, int ChapterId, string ChapterName,
    string FirstName, string? MiddleName, string LastName, string GiftName, DateOnly BirthDate,
    string MobileNo, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string SeconderNameGiven, string? SeconderMemberNumberGiven,
    string StatusName, DateTime SubmittedDateUtc, string? DecisionReason);

/// <summary>
/// Every editable field a returned applicant may correct. ChapterId and MobileNo are NOT
/// here — MobileNo is half of the lookup identity this endpoint is keyed by (see
/// usp_MembershipApplication_Resubmit's own header comment), and re-chaptering an application
/// is a separate concern this slice does not take on.
/// </summary>
public sealed record ResubmitMembershipApplicationRequest(
    string FirstName, string? MiddleName, string LastName, string GiftName,
    DateOnly BirthDate, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string SeconderNameGiven, string? SeconderMemberNumberGiven);

public sealed record MembershipApplicationResubmitResponseDto(string ReferenceNo, string StatusName);

public sealed record MembershipApplicationQueueRequest(int? StatusId = null, int Skip = 0, int Take = 50);

/// <summary>One row of a chapter admin's own review queue — everyone can see this much (§4.1).</summary>
public sealed record MembershipApplicationQueueItemDto(
    int ApplicationId, string ReferenceNo, string FirstName, string? MiddleName, string LastName,
    string GiftName, string MobileNo, string? Email, string StatusName, DateTime SubmittedDateUtc,
    int? DecidedBy, DateTime? DecidedDateUtc);

public sealed record MembershipApplicationUpdateDto(
    int MembershipApplicationUpdateId, DateTime UpdateDateUtc, int? UpdatedBy, string StatusName, string? Notes);

/// <summary>A prior CLOSED application from the same mobile number — the applicant's own history.</summary>
public sealed record MembershipApplicationPriorDto(
    int ApplicationId, string ReferenceNo, int ChapterId, string ChapterName,
    string StatusName, DateTime SubmittedDateUtc, DateTime? DecidedDateUtc, string? DecisionReason);

/// <summary>
/// The full application, for the chapter admin reviewing it — ChapterAdmin-and-the-chapter-
/// scoped-application only (CorrectiveActionFullDto's reasoning, not CorrectiveActionSummaryDto's:
/// this is the officer view, never shown to the wider membership).
/// </summary>
public sealed record MembershipApplicationDetailDto(
    int ApplicationId, string ReferenceNo, int ChapterId,
    string FirstName, string? MiddleName, string LastName, string GiftName, DateOnly BirthDate,
    string MobileNo, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string SeconderNameGiven, string? SeconderMemberNumberGiven, int? SeconderMemberId,
    string? SeconderResolvedGiftName, string? SeconderResolvedMemberNumber,
    string StatusName, DateTime SubmittedDateUtc,
    int? DecidedBy, DateTime? DecidedDateUtc, string? DecisionReason, int? CreatedMemberId,
    IReadOnlyList<MembershipApplicationUpdateDto> History,
    IReadOnlyList<MembershipApplicationPriorDto> PriorApplications);

/// <summary>
/// The admin's authenticated confirmation of who the free-text seconder actually is —
/// resolved from the existing member directory search, not looked up here (out of scope
/// for this slice; see usp_MembershipApplication_Approve's own header comment on why the
/// free-text answer at submission is never validated against real members).
/// </summary>
public sealed record ApproveMembershipApplicationRequest(int? SeconderMemberId);

/// <summary>
/// SHOW-ONCE. EnrolmentUrl carries the raw, unhashed enrolment token embedded in the URL. It
/// is returned to the caller on THIS response only — never logged (see MembershipApplicationsEndpoints.Approve),
/// never persisted anywhere in plaintext, and there is no endpoint to re-fetch it. If the
/// chapter admin loses it, the fix is issuing a fresh one (a later slice), not recovering this one.
/// </summary>
public sealed record ApproveMembershipApplicationResponseDto(
    int MemberId, string MemberNumber, string EnrolmentUrl, DateTime ExpiresOnUtc);

public sealed record DecideMembershipApplicationRequest(string Reason);

public sealed record MembershipApplicationDecisionResponseDto(int ApplicationId, string StatusName);
