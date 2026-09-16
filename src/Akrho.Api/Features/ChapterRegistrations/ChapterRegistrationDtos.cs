namespace Akrho.Api.Features.ChapterRegistrations;

/// <summary>
/// One of the eight seats on a brand-new chapter's charter petition, typed in — nobody exists
/// yet (no MemberId). A mobile number is required for every officer, including the three Master
/// Initiators, who receive no login (§7A.4).
/// </summary>
public sealed record ChapterCharterOfficerInputDto(
    int OfficeId, string FirstName, string? MiddleName, string LastName, string GiftName,
    DateOnly BirthDate, string MobileNo, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive);

/// <summary>
/// The public, unauthenticated charter petition. No chapterId anywhere — the chapter does not
/// exist yet. RegionId/ProvinceId/MunicipalityId are the petition's own stated location (there
/// is no caller identity yet to check them against, same reasoning as
/// SubmitMembershipApplicationRequest.ChapterId) — usp_ChapterRegistration_Submit validates the
/// geography is real and internally consistent, nothing more.
/// </summary>
public sealed record SubmitChapterRegistrationRequest(
    string ProposedChapterName, string? Barangay, int RegionId, int ProvinceId, int MunicipalityId,
    int? MarkAccentId, IReadOnlyList<ChapterCharterOfficerInputDto> Officers);

public sealed record SubmitChapterRegistrationResponseDto(string ReferenceNo);

/// <summary>
/// The "check my registration" and "resubmit" identification pair. BOTH must match the same
/// row's current President seat; a wrong reference and a wrong mobile number produce the
/// identical 404 — never differentiate them (usp_ChapterRegistration_GetByReference's own
/// header comment).
/// </summary>
public sealed record ChapterRegistrationIdentifyQuery(string ReferenceNo, string MobileNo);

/// <summary>The petitioner's own view of a registration's current state. Never carries the
/// officer roster — see usp_ChapterRegistration_GetByReference's own header comment.</summary>
public sealed record ChapterRegistrationStatusDto(
    string ReferenceNo, string RegistrationType, string? ProposedChapterName,
    int? ChapterId, string? ChapterName, string StatusName, DateTime SubmittedDateUtc,
    DateTime? DecidedDateUtc, string? DecisionReason,
    int ActingCouncilId, string ActingCouncilName);

/// <summary>
/// Every field a returned Charter petition may correct — the WHOLE form, roster and location
/// included, not just typos (usp_ChapterRegistration_Resubmit's own header comment). ReferenceNo
/// and MobileNo are NOT here — MobileNo is half of the lookup identity this endpoint is keyed by.
/// </summary>
public sealed record ResubmitChapterRegistrationRequest(
    string ProposedChapterName, string? Barangay, int RegionId, int ProvinceId, int MunicipalityId,
    int? MarkAccentId, IReadOnlyList<ChapterCharterOfficerInputDto> Officers);

public sealed record ResubmitChapterRegistrationResponseDto(int RegistrationId, string ReferenceNo, string StatusName);

/// <summary>One of the eight seats on a chapter's officer-turnover filing — a bare (office,
/// existing member) pair, selected from that same chapter's own roster. Never typed-in text —
/// see usp_ChapterRegistration_SubmitTurnover's own header comment on why.</summary>
public sealed record ChapterTurnoverOfficerInputDto(int OfficeId, int MemberId);

/// <summary>
/// The authenticated officer-turnover filing. NO chapterId anywhere — the filer's own chapter is
/// ALWAYS re-derived server-side from his currently-seated ChapterAdmin role
/// (ICurrentUser.MemberId only; CLAUDE.md invariant #4/#11).
/// </summary>
public sealed record SubmitChapterTurnoverRequest(IReadOnlyList<ChapterTurnoverOfficerInputDto> Officers);

public sealed record SubmitChapterTurnoverResponseDto(string ReferenceNo);

public sealed record ChapterRegistrationQueueRequest(int? StatusId = null, int Skip = 0, int Take = 50);

/// <summary>One row of a council officer's own registration queue. NO councilId anywhere in the
/// request — scoped entirely from ICurrentUser.CouncilIds server-side (via
/// usp_ChapterRegistration_GetQueue's own @RequestingMemberId derivation). CanAct is a display
/// convenience only, never itself a permission boundary.</summary>
public sealed record ChapterRegistrationQueueItemDto(
    int RegistrationId, string ReferenceNo, string RegistrationType, string? ProposedChapterName,
    int? ChapterId, string? ChapterName, string StatusName, DateTime SubmittedDateUtc,
    int ActingCouncilId, string ActingCouncilName, int? IntendedCouncilId, string RoutingReason,
    int? DecidedBy, DateTime? DecidedDateUtc, bool CanAct);

/// <summary>One of the eight seats, resolved identity included, for the council officer
/// reviewing the registration.</summary>
public sealed record ChapterRegistrationOfficerDto(
    int RegistrationOfficerId, int OfficeId, string OfficeName, int SortOrder, bool GrantsLogin,
    int? MemberId, string? MemberNumber,
    string FirstName, string? MiddleName, string LastName, string GiftName, DateOnly BirthDate,
    string MobileNo, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    int? VerifiedBy, string? VerifiedByGiftName, DateTime? VerifiedDateUtc, string? VerifyNote,
    int? CreatedMemberId);

public sealed record ChapterRegistrationUpdateDto(
    int ChapterRegistrationUpdateId, DateTime UpdateDateUtc, int? UpdatedBy, string StatusName, string? Notes);

public sealed record ChapterRegistrationRoutingDto(
    int RoutingId, int? IntendedCouncilId, int ActingCouncilId, string RoutingReason,
    int? ActorMemberId, DateTime ActedOnUtc, string? Remarks);

/// <summary>
/// The full registration, for the council officer reviewing it — same reasoning as
/// MembershipApplicationDetailDto: the reviewer view, never shown to the wider membership.
/// </summary>
public sealed record ChapterRegistrationDetailDto(
    int RegistrationId, string ReferenceNo, string RegistrationType, int? ChapterId, string? ChapterName,
    string? ProposedChapterName, string? Barangay, int? RegionId, int? ProvinceId, int? MunicipalityId,
    int? MarkAccentId, string? AccentName, string? HexValue,
    int? IntendedCouncilId, string? IntendedCouncilName,
    int ActingCouncilId, string ActingCouncilName, string RoutingReason,
    int? SubmittedByMemberId, string? SubmittedByGiftName,
    DateTime SubmittedDateUtc, string StatusName, bool IsOpen,
    int? DecidedBy, string? DecidedByGiftName, DateTime? DecidedDateUtc, string? DecisionReason,
    int? CreatedChapterId,
    IReadOnlyList<ChapterRegistrationOfficerDto> Officers,
    IReadOnlyList<ChapterRegistrationUpdateDto> History,
    ChapterRegistrationRoutingDto? Routing);

public sealed record VerifyChapterRegistrationOfficerRequest(bool Verified, string? Note);

public sealed record VerifyChapterRegistrationOfficerResponseDto(int RegistrationOfficerId, bool Verified);

/// <summary>Reason required, shown to the chapter — same >=10-character bar this codebase uses
/// everywhere a reason is shown to the person on the other end.</summary>
public sealed record ReturnChapterRegistrationRequest(string Reason);

public sealed record ReturnChapterRegistrationResponseDto(int RegistrationId, string StatusName);

/// <summary>
/// SHOW-ONCE. EnrolmentUrl carries the raw, unhashed enrolment token embedded in the URL — the
/// one and only response that will ever hold it, exactly like ApproveMembershipApplicationResponseDto.
/// </summary>
public sealed record ChapterCharterApprovalResultDto(
    int PresidentMemberId, string MemberNumberPrefix, string EnrolmentUrl, DateTime ExpiresOnUtc);

/// <summary>One newly-enrolled incoming Turnover officer's SHOW-ONCE link. An officer who kept an
/// account he already held is simply absent from this list — no link is issued to him.</summary>
public sealed record ChapterTurnoverOfficerEnrolmentDto(int MemberId, string EnrolmentUrl, DateTime ExpiresOnUtc);

/// <summary>
/// The approval result branches entirely on RegistrationType — exactly one of
/// <see cref="Charter"/> / <see cref="TurnoverEnrolments"/> is populated. Never logged, never
/// persisted, never re-fetchable: a lost link means issuing a fresh one, not recovering this one.
/// </summary>
public sealed record ApproveChapterRegistrationResponseDto(
    int ChapterId, string RegistrationType,
    ChapterCharterApprovalResultDto? Charter,
    IReadOnlyList<ChapterTurnoverOfficerEnrolmentDto>? TurnoverEnrolments);
