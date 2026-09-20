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
