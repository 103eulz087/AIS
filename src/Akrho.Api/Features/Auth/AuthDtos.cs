namespace Akrho.Api.Features.Auth;

public sealed record SignInRequest(string MemberNumber, string Password);

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
