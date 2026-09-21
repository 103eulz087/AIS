namespace Akrho.Api.Features.Councils;

/// <summary>One row of GET /api/councils/{councilId}/eligible-officers — an
/// in-jurisdiction candidate. Never contact details, blood type or anything outside
/// invariant #7's cross-chapter shape.</summary>
public sealed record CouncilOfficerCandidateDto(
    int MemberId, string GiftName, string MemberNumber, string FullName,
    int ChapterId, string ChapterName, DateOnly? RenewedThrough,
    bool IsCurrent, bool IsLapsed, bool NoMobileNumber);

/// <summary>GET /api/councils/member-lookup?councilId=&memberNumber= — for an
/// out-of-jurisdiction nominee, found by exact number only, never a browsable list
/// (invariant #7).</summary>
public sealed record CouncilMemberLookupDto(
    int MemberId, string GiftName, string MemberNumber, string? ChapterName, string StatusName,
    DateOnly? RenewedThrough, bool IsCurrent, bool IsLapsed, bool NoMobileNumber);

/// <summary>POST /api/councils — geography-driven; exactly one of RegionId/ProvinceId/
/// MunicipalityId. See usp_Council_Create's own header for why.</summary>
public sealed record CreateCouncilRequest(
    int ParentCouncilId, string CouncilName, int? RegionId, int? ProvinceId, int? MunicipalityId);

public sealed record CouncilCreatedDto(int CouncilId, bool WasCreated);

/// <summary>POST /api/councils/{councilId}/officers. TermEnd omitted means an open
/// term. OutsideJurisdictionReason is required by the procedure itself (THROW 51675)
/// when the nominee is not from a chapter in this council's own subtree — never a
/// waiver, always a permanent record (invariant #13b).</summary>
public sealed record SeatCouncilOfficerRequest(
    int MemberId, int CouncilOfficeId, DateOnly TermStart, DateOnly? TermEnd, string? OutsideJurisdictionReason);

/// <summary>SHOW-ONCE when EnrolmentUrl is non-null — the nominee's very first
/// enrolment link, issued in the same transaction as the seat itself, only when he had
/// no account yet and had never redeemed one. Null EnrolmentUrl means he already has a
/// working login elsewhere and needs none — never a password either way (invariant #16).</summary>
public sealed record CouncilSeatResultDto(
    int MemberRoleId, bool WasInJurisdiction, string? EnrolmentUrl, DateTime? ExpiresOnUtc);

/// <summary>DELETE /api/councils/{councilId}/officers/{memberRoleId} — the verb is
/// "unseat"; the row survives with TermEnd set (invariant #15's own logic extended to
/// MemberRole — nothing here is ever deleted).</summary>
public sealed record UnseatCouncilOfficerRequest(string Reason);

/// <summary>GET /api/councils?councilId= (councilId optional — defaults to the
/// caller's own highest seat). One row per council in the requested subtree, each
/// carrying enough to render "never constituted" / "dormant" / "seated" / "dissolved"
/// in plain language rather than a bare officer count.</summary>
public sealed record CouncilRegistryDto(
    int CouncilId, string CouncilName, string LevelName, int? ParentCouncilId, int Depth,
    bool IsActive, bool IsDissolved, bool HasSeatedOfficers, bool NeverConstituted, bool IsDormant,
    int SeatedOfficerCount, int DirectChildCouncilCount, int DirectChapterCount, int DirectMemberCount);

/// <summary>One row of GET /api/councils/{councilId}/officers's Seats array.</summary>
public sealed record CouncilRosterSeatDto(
    int MemberRoleId, int? CouncilOfficeId, string? OfficeName, string RoleName,
    int MemberId, string GiftName, string MemberNumber, string FullName, string? HomeChapterName,
    DateOnly TermStart, DateOnly? TermEnd, bool IsCurrent, DateOnly? RenewedThrough, bool HasAccount);

/// <summary>One row of GET /api/councils/{councilId}/officers's Overrides array —
/// permanent, never filtered out (invariant #13b: "no waiver, no approval step, just a
/// permanent record").</summary>
public sealed record CouncilSeatOverrideDto(
    int SeatOverrideId, int MemberRoleId, string GiftName, string MemberNumber,
    string? HomeChapterName, string Reason, DateTime SeatedOnUtc, string SeatedByGiftName);

public sealed record CouncilRosterDto(
    IReadOnlyList<CouncilRosterSeatDto> Seats, IReadOnlyList<CouncilSeatOverrideDto> Overrides);
