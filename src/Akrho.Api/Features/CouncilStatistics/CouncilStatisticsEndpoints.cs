using Akrho.Api.Common;
using Akrho.Domain;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.CouncilStatistics;

public static class CouncilStatisticsEndpoints
{
    public static IEndpointRouteBuilder MapCouncilStatistics(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/councils").WithTags("CouncilStatistics");

        // No councilId anywhere in this route — the caller's own seat, resolved entirely
        // inside usp_CouncilStatistics_Get from @RequestingMemberId (CLAUDE.md invariant #4/#11).
        g.MapGet("/statistics", GetOwn).WithName("GetOwnCouncilStatistics")
            .RequireAuthorization(AuthorizationPolicies.CouncilStatisticsRead);

        // Explicit focus council. Still never trusted on its own: the procedure re-checks the
        // caller's own council seat against it (51621) even though EnsureAnyCouncilSeat below
        // already confirmed he holds SOME seat — same defence-in-depth posture as every other
        // council-facing route in this codebase.
        g.MapGet("/{councilId:int}/statistics", GetForCouncil).WithName("GetCouncilStatistics")
            .RequireAuthorization(AuthorizationPolicies.CouncilStatisticsRead);

        return app;
    }

    // skip/take default to usp_CouncilStatistics_Get's own @Skip = 0 / @Take = 100 exactly —
    // ASP.NET Core minimal-API query binding treats a plain-type parameter with a C# default
    // value as optional, same as every other query-bound int in this codebase.
    private static Task<Results<Ok<CouncilStatisticsResponse>, BadRequest<string>, ProblemHttpResult>> GetOwn(
        DateOnly? from, DateOnly? to,
        ICouncilStatisticsRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct,
        int skip = 0, int take = 100)
        => Get(focusCouncilId: null, from, to, Math.Max(skip, 0), ClampTake(take), repo, caller, scope, ct);

    private static Task<Results<Ok<CouncilStatisticsResponse>, BadRequest<string>, ProblemHttpResult>> GetForCouncil(
        int councilId, DateOnly? from, DateOnly? to,
        ICouncilStatisticsRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct,
        int skip = 0, int take = 100)
        => Get(councilId, from, to, Math.Max(skip, 0), ClampTake(take), repo, caller, scope, ct);

    // Never trust the caller's own take value beyond a sane upper bound (500, same ceiling as
    // ChapterRegistrationQueueRequestValidator's own Take rule) — a 0/omitted value falls back
    // to the procedure's own default of 100.
    private static int ClampTake(int take) => take <= 0 ? 100 : Math.Clamp(take, 1, 500);

    private static async Task<Results<Ok<CouncilStatisticsResponse>, BadRequest<string>, ProblemHttpResult>> Get(
        int? focusCouncilId, DateOnly? from, DateOnly? to, int skip, int take,
        ICouncilStatisticsRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        // Defence in depth before the round trip even happens — the procedure's own
        // @RequestingMemberId-derived check (51620/51621) remains the actual authority.
        scope.EnsureAnyCouncilSeat(caller);

        // Same independent-per-side default as DashboardEndpoints.Get — never reimplemented
        // membership-year logic, always Akrho.Domain.MembershipYear.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var currentYear = MembershipYear.YearFor(today);
        var fromDate = from ?? MembershipYear.StartsOn(currentYear);
        var toDate = to ?? MembershipYear.EndsOn(currentYear);

        if (fromDate > toDate)
            return TypedResults.BadRequest("The start date must be before the end date.");

        try
        {
            var rows = await repo.GetAsync(caller.MemberId, focusCouncilId, fromDate, toDate, skip, take, ct);
            return TypedResults.Ok(Map(fromDate, toDate, rows));
        }
        catch (CouncilStatisticsException ex)
        {
            // 51620 — caller holds no council seat at all. 51621 — caller holds a seat, but
            // not over the requested FocusCouncilId. Both are a standing problem, not a
            // missing-resource one: surfaced as 403, same convention as
            // ChapterRegistrationsEndpoints.GetQueue / ChaptersEndpoints.GetOwnInviteLink.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static CouncilStatisticsResponse Map(DateOnly fromDate, DateOnly toDate, CouncilStatisticsRows rows) => new(
        fromDate, toDate,
        MapRollup(rows.Focus),
        rows.ChildCouncils.Select(MapRollup).ToList(),
        rows.Chapters.Select(MapChapter).ToList(),
        rows.CorrectiveActionTotals
            .Select(r => new CorrectiveActionStatusCountDto(r.StatusName, r.CaseCount))
            .ToList(),
        rows.Chapters.Count > 0 ? rows.Chapters[0].TotalCount : 0);

    private static CouncilRollupDto MapRollup(CouncilRollupRow r) => new(
        r.CouncilId, r.CouncilName, r.LevelName, r.ParentCouncilId, r.Depth,
        r.HasSeatedOfficers, r.DirectChildCouncilCount, r.TotalCouncilsInSubtree,
        r.DirectChapterCount, r.TotalChaptersInSubtree, r.ActiveChapterCount, r.InactiveChapterCount,
        r.MemberTotal, r.MemberPending, r.MemberApproved, r.MemberActive, r.MemberInactive,
        r.MemberSuspended, r.MemberRejected, r.NewThisPeriod, r.DetachedMemberCount,
        r.RenewedCount, r.LapsedCount, r.ExemptCount, r.NotRecordedCount, r.HasRenewalData,
        r.RegSubmittedCount, r.RegReturnedForCorrectionCount, r.RegApprovedCount,
        r.MeetingsHeld, r.TotalPresent, r.TotalOnSheets, r.AveragePresentPerMeeting);

    private static ChapterStatisticsDto MapChapter(ChapterStatisticsRow r) => new(
        r.ChapterId, r.ChapterName, r.Barangay, r.ParentCouncilId, r.ParentCouncilName,
        r.IsActive, r.MemberTotal, r.MemberPending, r.MemberApproved, r.MemberActive,
        r.MemberInactive, r.MemberSuspended, r.MemberRejected, r.NewThisPeriod,
        r.RenewedCount, r.LapsedCount, r.ExemptCount, r.NotRecordedCount, r.HasRenewalData,
        r.MeetingsHeld, r.TotalPresent, r.TotalOnSheets, r.AveragePresentPerMeeting,
        r.OpeningBalance, r.PeriodIn, r.PeriodOut, r.ClosingBalance,
        r.CaseCountPending, r.CaseCountUnderReview, r.CaseCountReconciled, r.CaseCountDismissed);
}
