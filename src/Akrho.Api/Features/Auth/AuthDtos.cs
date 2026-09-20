namespace Akrho.Api.Features.Auth;

/// <summary>Identifier accepts either a member number (AKR-RR-CCCC-NNN) or the mobile
/// number on file — usp_Auth_GetAccountForSignIn matches either.</summary>
public sealed record SignInRequest(string Identifier, string Password);

/// <summary>The access token only — the refresh token rides an httpOnly cookie, never the body.</summary>
public sealed record SignInResponseDto(string AccessToken, DateTime ExpiresAtUtc);

/// <summary>
/// The caller's own record, sourced only from the authenticated principal. ChapterName is
/// deliberately absent for now: no stored procedure currently joins a member's claims to
/// dbo.Chapter for its name, and this endpoint does not invent a query around that gap —
/// see the note in AuthEndpoints.Me.
/// </summary>
public sealed record MeResponseDto(
    int MemberId, int ChapterId, string? ChapterName, string GiftName, IReadOnlyList<string> Roles);

/// <summary>POST /api/auth/change-password — a signed-in member setting his own password.
/// CurrentPassword is verified against the account on file before NewPassword is accepted;
/// neither ever reaches the database as plaintext (CLAUDE.md invariant #16).</summary>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
