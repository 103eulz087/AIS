namespace Akrho.Api.Features.Chapters;

/// <summary>
/// One row of the public sign-up form's chapter picker. Names only — no counts, no member
/// data, nothing personal. This predates sign-in entirely, so it carries none of the
/// cross-chapter restraint DTOs elsewhere in this codebase need (CLAUDE.md invariant #7);
/// there is simply nothing sensitive on this shape to restrain.
/// </summary>
public sealed record ChapterPublicDto(int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName);
