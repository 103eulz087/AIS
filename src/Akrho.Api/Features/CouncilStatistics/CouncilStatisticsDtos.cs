namespace Akrho.Api.Features.CouncilStatistics;

/// <summary>
/// A council rolled up over its own entire subtree. Same shape for the focus council and
/// each of its direct child councils — mirrors <c>CouncilRollupRow</c>
/// (Akrho.Infrastructure.Repositories.CouncilStatisticsRepository). Every figure here is a
/// count or an average; there is no member-identifying detail and no "amount owed" field
/// anywhere (CLAUDE.md invariant #5).
/// </summary>
public sealed record CouncilRollupDto(
    int CouncilId, string CouncilName, string LevelName, int? ParentCouncilId, int Depth,
    bool HasSeatedOfficers, int DirectChildCouncilCount, int TotalCouncilsInSubtree,
    int DirectChapterCount, int TotalChaptersInSubtree, int ActiveChapterCount, int InactiveChapterCount,
    int MemberTotal, int MemberPending, int MemberApproved, int MemberActive, int MemberInactive,
    int MemberSuspended, int MemberRejected, int NewThisPeriod, int DetachedMemberCount,
    int RenewedCount, int LapsedCount, int ExemptCount, int NotRecordedCount, bool HasRenewalData,
    int RegSubmittedCount, int RegReturnedForCorrectionCount, int RegApprovedCount,
    int MeetingsHeld, int TotalPresent, int TotalOnSheets, decimal AveragePresentPerMeeting);

/// <summary>
/// One chapter in the focus council's entire subtree (not just direct children). Money
/// fields are <c>decimal</c>, never <c>double</c>/<c>float</c> (CLAUDE.md hard rule), and
/// there is no "amount owed"/arrears figure anywhere (CLAUDE.md invariant #5) —
/// OpeningBalance/PeriodIn/PeriodOut/ClosingBalance are the chapter's own ledger totals.
/// No <c>₱</c> formatting here; that is the frontend's job entirely.
/// </summary>
public sealed record ChapterStatisticsDto(
    int ChapterId, string ChapterName, string? Barangay, int ParentCouncilId, string ParentCouncilName,
    bool IsActive, int MemberTotal, int MemberPending, int MemberApproved, int MemberActive,
    int MemberInactive, int MemberSuspended, int MemberRejected, int NewThisPeriod,
    int RenewedCount, int LapsedCount, int ExemptCount, int NotRecordedCount, bool HasRenewalData,
    int MeetingsHeld, int TotalPresent, int TotalOnSheets, decimal AveragePresentPerMeeting,
    decimal OpeningBalance, decimal PeriodIn, decimal PeriodOut, decimal ClosingBalance,
    int CaseCountPending, int CaseCountUnderReview, int CaseCountReconciled, int CaseCountDismissed);

/// <summary>
/// One status bucket, council-wide. Always four of these — Pending, Under Review,
/// Reconciled, Dismissed — zero-filled, never a case list or a member name (CLAUDE.md
/// invariant #6).
/// </summary>
public sealed record CorrectiveActionStatusCountDto(string StatusName, int CaseCount);

/// <summary>
/// GET /api/councils/statistics and GET /api/councils/{councilId}/statistics.
/// <see cref="FromDate"/>/<see cref="ToDate"/> echo the range actually applied — same
/// convention as <c>DashboardDto</c>: when the caller omits both, the server defaults to
/// the current membership year, and this is the only way the client learns what dates
/// that resolved to.
/// <see cref="TotalChapterCount"/> is the total row count across ALL pages of
/// <see cref="Chapters"/> (Set 3's own <c>COUNT(*) OVER()</c>), for pagination UI — 0 when
/// the subtree has no chapters at all.
/// </summary>
public sealed record CouncilStatisticsResponse(
    DateOnly FromDate,
    DateOnly ToDate,
    CouncilRollupDto Focus,
    IReadOnlyList<CouncilRollupDto> ChildCouncils,
    IReadOnlyList<ChapterStatisticsDto> Chapters,
    IReadOnlyList<CorrectiveActionStatusCountDto> CorrectiveActionTotals,
    int TotalChapterCount);
