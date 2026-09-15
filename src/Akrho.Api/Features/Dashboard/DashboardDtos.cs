namespace Akrho.Api.Features.Dashboard;

/// <summary>
/// Chapter-wide totals only, derived from dbo.LedgerEntry. Never a per-member figure, and
/// never a collection/arrears figure (CLAUDE.md invariant #5) — these are totals and
/// balances exactly as usp_Dashboard_GetChapterSummary computed them.
/// </summary>
public sealed record DashboardFinancialDto(
    decimal OpeningBalance, decimal PeriodIn, decimal PeriodOut, decimal ClosingBalance,
    decimal CurrentBalance, decimal InFromMeetings, decimal InFromDonations, decimal InOther,
    decimal OutOnExpenses, decimal OutOther);

/// <summary>
/// Headcounts by status only — no member list, no names. Six buckets (the real seeded
/// dbo.MemberStatus values), not the four an earlier draft assumed.
/// </summary>
public sealed record DashboardMembershipDto(
    int Total, int Pending, int Approved, int Active, int Inactive, int Suspended, int Rejected,
    int NewThisPeriod);

/// <summary>
/// Attendance as a headcount first ("N present of M on the sheet"). AveragePresentPerMeeting
/// is a chapter-wide mean, never a contribution/collection rate.
/// </summary>
public sealed record DashboardActivityDto(
    int MeetingsHeld, int TotalPresent, int TotalOnSheets, decimal AveragePresentPerMeeting);

/// <summary>
/// One status bucket. Always four of these in the response — Pending, Under Review,
/// Reconciled, Dismissed — zero-filled, never a case list or a member name
/// (CLAUDE.md invariant #6).
/// </summary>
public sealed record CorrectiveActionStatusCountDto(string StatusName, int CaseCount);

/// <summary>
/// GET /api/chapters/{chapterId}/dashboard. FromDate/ToDate echo back whatever range was
/// actually applied — including any default the endpoint computed from
/// <see cref="Akrho.Domain.MembershipYear"/> — so the client never has to re-derive it to
/// know what it's looking at.
/// </summary>
public sealed record DashboardDto(
    DateOnly FromDate, DateOnly ToDate,
    DashboardFinancialDto Financial,
    DashboardMembershipDto Membership,
    DashboardActivityDto Activity,
    IReadOnlyList<CorrectiveActionStatusCountDto> CorrectiveActionCounts);
