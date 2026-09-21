namespace Akrho.Api.Features.Chapters;

/// <summary>
/// One row of the public sign-up form's chapter picker. Names only — no counts, no member
/// data, nothing personal. This predates sign-in entirely, so it carries none of the
/// cross-chapter restraint DTOs elsewhere in this codebase need (CLAUDE.md invariant #7);
/// there is simply nothing sensitive on this shape to restrain.
/// </summary>
public sealed record ChapterPublicDto(int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName);

/// <summary>GET /api/chapters/me/invite-link — never the raw token; see
/// usp_ChapterInviteLink_Regenerate's own header for why there is no way to recover one
/// once issued, only to replace it.</summary>
public sealed record ChapterInviteLinkStatusDto(bool HasLink, DateTime? CreatedDateUtc);

/// <summary>POST /api/chapters/me/invite-link/regenerate — SHOW-ONCE, same discipline as
/// ReissueMemberEnrolmentLinkResponseDto: this is the only response that will ever carry
/// this link's raw token, embedded in JoinUrl. A lost link means generating another.</summary>
public sealed record ChapterInviteLinkIssuedDto(string JoinUrl, DateTime CreatedDateUtc);

/// <summary>GET /api/chapters/invite/{token} — the public "join this chapter" landing
/// page's only data source. IsValid=false for an unknown/invalidated token or a chapter
/// that has since gone inactive — all three read identically, on purpose (anti-
/// enumeration, see the procedure's own header comment).</summary>
public sealed record ChapterInviteLinkResolvedDto(bool IsValid, int? ChapterId, string? ChapterName);

/// <summary>One row of GET /api/chapters/{chapterId}/officers — a chapter office seat,
/// current or ended. No SeatOverride equivalent here (unlike councils): a chapter
/// officer is always a member of that same chapter, never seated from outside.</summary>
public sealed record ChapterOfficerRosterSeatDto(
    int MemberRoleId, int OfficeId, string OfficeName, int SortOrder, bool GrantsLogin, string RoleName,
    int MemberId, string GiftName, string MemberNumber, string FullName,
    DateOnly TermStart, DateOnly? TermEnd, bool IsCurrent, DateOnly? RenewedThrough, bool HasAccount);

/// <summary>POST /api/chapters/{chapterId}/officers. Seating the President needs the
/// council above this chapter; every other office needs only the chapter's own seated
/// President — usp_Chapter_SeatOfficer's own split (client decision 2026-09-22).</summary>
public sealed record SeatChapterOfficerRequest(int MemberId, int OfficeId, DateOnly TermStart);

public sealed record ChapterOfficerSeatResultDto(int MemberRoleId);

/// <summary>DELETE /api/chapters/{chapterId}/officers/{memberRoleId} — "unseat," not
/// delete; the row survives with TermEnd set (invariant #15's logic extended to
/// MemberRole).</summary>
public sealed record UnseatChapterOfficerRequest(string Reason);
