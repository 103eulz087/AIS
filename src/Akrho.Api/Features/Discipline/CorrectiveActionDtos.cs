namespace Akrho.Api.Features.Discipline;

/// <summary>
/// Public shape — everyone in the chapter sees this much of a case: who, category, status,
/// dates. No narrative. Matches CLAUDE.md invariant #6's "name, category, status, date" rule
/// and mirrors <c>MemberCrossChapterDto</c>'s "absent, not empty" reasoning: the restricted
/// fields simply do not exist on this type, so there is nothing here for a later refactor to
/// "just fill in".
/// </summary>
public sealed record CorrectiveActionSummaryDto(
    int CaseId, int MemberId, string GiftName, string MemberNumber,
    int CategoryId, string CategoryName,
    string StatusName, DateOnly DateFiled, DateOnly? ResolutionDate);

/// <summary>
/// Restricted shape — returned ONLY when the database's own <c>CanSeeNarrative</c> bit says
/// so (the subject himself, or a chapter officer). Carries every field <see cref="CorrectiveActionSummaryDto"/>
/// does, plus the written account.
/// </summary>
public sealed record CorrectiveActionFullDto(
    int CaseId, int MemberId, string GiftName, string MemberNumber,
    int CategoryId, string CategoryName,
    string StatusName, DateOnly DateFiled, DateOnly? ResolutionDate,
    string Content, string? ResolutionNotes, int FiledBy, string FiledByGiftName);

/// <summary>
/// One status-history entry, public shape — status and date, always visible to the whole
/// chapter (CLAUDE.md invariant #6's "four-field rule": name/category/status/date are never
/// restricted). No UpdatedBy, no Notes.
/// </summary>
public sealed record CorrectiveActionTimelineEntrySummaryDto(int UpdateId, DateTime UpdateDateUtc, string StatusName);

/// <summary>
/// One status-history entry, restricted shape — same gate as the case header
/// (<c>CanSeeNarrative</c>), not a second, independent visibility decision.
/// </summary>
public sealed record CorrectiveActionTimelineEntryFullDto(
    int UpdateId, DateTime UpdateDateUtc, string StatusName,
    int UpdatedBy, string UpdatedByGiftName, string? Notes);

/// <summary>GET .../corrective-actions/{caseId} response when the caller cannot see the narrative.</summary>
public sealed record CorrectiveActionCaseSummaryDto(
    CorrectiveActionSummaryDto Case, IReadOnlyList<CorrectiveActionTimelineEntrySummaryDto> Timeline);

/// <summary>GET .../corrective-actions/{caseId} response when the caller can see the narrative.</summary>
public sealed record CorrectiveActionCaseFullDto(
    CorrectiveActionFullDto Case, IReadOnlyList<CorrectiveActionTimelineEntryFullDto> Timeline);

/// <summary>
/// POST .../corrective-actions. InitialStatusName is optional — omit it and the procedure's
/// own default ('Pending') applies. CLAUDE.md: never compute arrears, never touch Content
/// again after this call — there is no "edit narrative" request anywhere in this feature.
/// </summary>
public sealed record FileCorrectiveActionRequest(
    int SubjectMemberId, int CategoryId, DateOnly DateFiled, string Content, string? InitialStatusName);

public sealed record FiledCorrectiveActionDto(int CaseId);

/// <summary>
/// POST .../corrective-actions/{caseId}/updates. The ONLY way a case's status ever changes —
/// there is no PUT/PATCH on the case itself, and never will be.
/// </summary>
public sealed record AddCorrectiveActionUpdateRequest(string NewStatusName, string? Notes);

public sealed record CorrectiveActionUpdateAddedDto(int CaseId, string StatusName);

public sealed record CorrectiveActionListRequest(int Skip = 0, int Take = 50);
