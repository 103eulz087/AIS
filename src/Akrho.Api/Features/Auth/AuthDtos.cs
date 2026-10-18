namespace Akrho.Api.Features.Auth;

/// <summary>Identifier accepts either a member number (AKR-RR-CCCC-NNN) or the mobile
/// number on file — usp_Auth_GetAccountForSignIn matches either.</summary>
public sealed record SignInRequest(string Identifier, string Password);

/// <summary>The access token only — the refresh token rides an httpOnly cookie, never the body.</summary>
public sealed record SignInResponseDto(string AccessToken, DateTime ExpiresAtUtc);

/// <summary>
/// One council seat the caller currently holds (usp_CouncilPermission_GetMine), with the
/// effective permission keys that seat carries (dbo.fn_MemberSeatPermissions, keys for THIS
/// CouncilId only). This is a convenience projection for the frontend to decide what to show —
/// it carries no standing of its own; every council-facing procedure re-derives the caller's
/// real seats and permissions server-side regardless (CLAUDE.md invariant #4). Deliberately
/// NOT placed in the JWT (ICurrentUser/AccessTokenService are unchanged) — permissions can
/// change between token refreshes, and a token is the wrong place to cache something this
/// mutable.
/// </summary>
public sealed record CouncilSeatPermissionsDto(
    int CouncilId, string CouncilName, string OfficeName, bool CanManagePermissions,
    IReadOnlyList<string> Permissions);

/// <summary>
/// The caller's own record, sourced only from the authenticated principal. ChapterName is
/// deliberately absent for now: no stored procedure currently joins a member's claims to
/// dbo.Chapter for its name, and this endpoint does not invent a query around that gap —
/// see the note in AuthEndpoints.Me. CouncilSeats is empty for a caller who holds no council
/// seat at all (an ordinary chapter member).
/// </summary>
public sealed record MeResponseDto(
    int MemberId, int ChapterId, string? ChapterName, string GiftName, IReadOnlyList<string> Roles,
    IReadOnlyList<CouncilSeatPermissionsDto> CouncilSeats);

/// <summary>POST /api/auth/change-password — a signed-in member setting his own password.
/// CurrentPassword is verified against the account on file before NewPassword is accepted;
/// neither ever reaches the database as plaintext (CLAUDE.md invariant #16).</summary>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
