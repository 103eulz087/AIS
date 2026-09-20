namespace Akrho.Api.Features.Verification;

/// <summary>
/// POST /api/verifications body — the public, anonymous verify/scan request. Token is the
/// opaque credential subject carried by the QR payload (CLAUDE.md invariant #8) — never a
/// MemberId. WasOffline/DeviceHint are client-supplied scan-context hints only, mirrored
/// straight into dbo.ScanLog by the procedure; nothing here is ever trusted for anything else.
/// </summary>
public sealed record VerifyTokenRequest(Guid Token, bool WasOffline = false, string? DeviceHint = null);

/// <summary>
/// POST /api/verifications response — the anonymous public verification page's ENTIRE view.
/// IsValid=false collapses every failure case (unknown token, revoked, expired, deleted member)
/// into identical NULLs, mirroring usp_Credential_VerifyPublic's own anti-enumeration shape —
/// never branch on why a token failed. PhotoUrl is only ever non-null when IsValid is true; a
/// missing photo on file is the photo endpoint's own 404 to signal, never detected or hidden
/// here (same posture MembersEndpoints already uses for its own PhotoUrl).
/// </summary>
public sealed record PublicVerificationDto(
    bool IsValid, string? GiftName, string? ChapterName, string? StatusName,
    DateOnly? RenewedThrough, string? PhotoUrl);

/// <summary>
/// POST /api/scans response — the in-app, signed-in counterpart to <see cref="PublicVerificationDto"/>.
/// FullName/MemberNumber/BloodTypeName are only ever non-null when IsSameChapter is true; the
/// procedure itself enforces this gate (CLAUDE.md invariant #7) — never re-filter or second-guess
/// it here.
/// </summary>
public sealed record MemberScanResultDto(
    bool IsValid, string? GiftName, string? ChapterName, string? StatusName, DateOnly? RenewedThrough,
    bool IsSameChapter, string? FullName, string? MemberNumber, string? BloodTypeName);

/// <summary>
/// GET /api/members/me/scans — one row of "who scanned my card, and when." ScannerGiftName and
/// ScannerChapterName are NULL together for an anonymous scan (the public verification page); the
/// scanner's own identity is never revealed beyond gift name + chapter, matching every other
/// cross-chapter exposure in this system (CLAUDE.md invariant #7).
/// </summary>
public sealed record ScanLogEntryDto(
    DateTime ScanDate, string ResultCode, bool WasOffline, string? ScannerGiftName, string? ScannerChapterName);
