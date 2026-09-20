namespace Akrho.Api.Features.Credential;

/// <summary>
/// GET /api/members/me/credential. What the caller's OWN Digital ID screen needs to render —
/// front (gift name, chapter, council chain, status, seal) and back (member number, date
/// survive, blood type, QR). Self-only, same posture as MemberProfileDto: never returned for any
/// member other than the caller's own.
///
/// Deliberately does NOT expose MemberId anywhere (CLAUDE.md invariant #8: the QR/verification
/// payload is opaque — a credential id, chapter code, member number, status — never a MemberId,
/// never a name). TokenSubject itself appears ONLY inside <see cref="VerificationUrl"/>, which is
/// a relative path (`/verify/{tokenSubject}`) for the frontend to resolve against its own origin —
/// never an absolute URL with a hardcoded domain.
/// </summary>
public sealed record MyCredentialDto(
    string GiftName, string FullName, string MemberNumber,
    string? ChapterName, string? ChapterCode,
    string? NationalCouncilName, string? RegionName, string? ProvinceName, string? CityName,
    DateOnly? DateSurvive, string? BloodTypeName,
    string StatusName,
    // NULL is normal here — it means no Portal renewal has run yet, not "lapsed". The frontend,
    // not this DTO, decides how to word that; nothing here coerces it into a fake status.
    DateOnly? RenewedThrough,
    DateTime CredentialIssuedDateUtc, DateTime CredentialExpiryDateUtc,
    string VerificationUrl);

/// <summary>
/// POST /api/scans body — the in-app, signed-in scan. Same shape as
/// Verification.VerifyTokenRequest (the anonymous counterpart); kept as its own record rather
/// than shared across features, matching this codebase's convention of not cross-referencing
/// DTOs between feature folders. Token is the opaque credential subject from the scanned QR
/// (CLAUDE.md invariant #8), never a MemberId.
/// </summary>
public sealed record ScanRequest(Guid Token, bool WasOffline = false, string? DeviceHint = null);

/// <summary>GET /api/members/me/scans query — paged, newest first.</summary>
public sealed record ScanLogListQuery(int PageSize = 20, int PageNumber = 1);
