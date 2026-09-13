namespace Akrho.Api.Features.Members;

/// <summary>Full member record. Returned only to members of the SAME chapter.</summary>
public sealed record MemberDto(
    int MemberId, string GiftName, string MemberNumber, int ChapterId, string ChapterName,
    string Status, string? FullName, string? MobileNo, string? Profession,
    string? BloodType, string? PhotoUrl, DateOnly? RenewedThrough, bool IsCurrent);

/// <summary>
/// Cross-chapter shape. Client decision: name, chapter and status ONLY.
/// The other fields are ABSENT, not empty — absent is safe, empty invites a later
/// refactor to "just fill them in".
/// </summary>
public sealed record MemberCrossChapterDto(
    int MemberId, string GiftName, int ChapterId, string ChapterName, string Status);

public sealed record MemberSearchRequest(
    int? ChapterId = null, string? Search = null, int? BloodTypeId = null,
    int? SkillId = null, bool IncludeInactive = false, int Skip = 0, int Take = 50);
