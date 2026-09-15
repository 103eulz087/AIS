using Akrho.Domain;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Dashboard;

public static class DashboardEndpoints
{
    public static IEndpointRouteBuilder MapDashboard(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/dashboard")
                   .WithTags("Dashboard").RequireAuthorization();

        // No policy beyond authentication — every member of the chapter, not just
        // officers, sees the same books (CLAUDE.md §1 / docs §4.7).
        g.MapGet("", Get).WithName("GetChapterDashboard");

        return app;
    }

    private static async Task<Results<Ok<DashboardDto>, BadRequest<string>, ProblemHttpResult>> Get(
        int chapterId, DateOnly? from, DateOnly? to,
        IDashboardRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        // chapterId comes from the route, but the caller's OWN chapter comes from the JWT
        // (CLAUDE.md invariant #11) — this is the only authorization check this endpoint
        // needs; the procedure's own membership check is defence in depth underneath it.
        scope.EnsureChapter(caller, chapterId);

        // The default range is "the current membership year" — computed from
        // Akrho.Domain.MembershipYear, never reimplemented here. Each side of the range
        // defaults independently, so a caller who supplies only one of from/to still gets
        // a sensible other end rather than being forced to supply both.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var currentYear = MembershipYear.YearFor(today);
        var fromDate = from ?? MembershipYear.StartsOn(currentYear);
        var toDate = to ?? MembershipYear.EndsOn(currentYear);

        if (fromDate > toDate)
            return TypedResults.BadRequest("The start date must be before the end date.");

        try
        {
            var rows = await repo.GetChapterSummaryAsync(chapterId, caller.MemberId, fromDate, toDate, ct);

            var financial = rows.Financial;
            var membership = rows.Membership;
            var activity = rows.Activity;

            var dto = new DashboardDto(
                fromDate, toDate,
                new DashboardFinancialDto(
                    financial.OpeningBalance, financial.PeriodIn, financial.PeriodOut, financial.ClosingBalance,
                    financial.CurrentBalance, financial.InFromMeetings, financial.InFromDonations, financial.InOther,
                    financial.OutOnExpenses, financial.OutOther),
                new DashboardMembershipDto(
                    membership.Total, membership.Pending, membership.Approved, membership.Active,
                    membership.Inactive, membership.Suspended, membership.Rejected, membership.NewThisPeriod),
                new DashboardActivityDto(
                    activity.MeetingsHeld, activity.TotalPresent, activity.TotalOnSheets,
                    // The proc can hand back a long decimal (e.g. 5.0000000000000) when it
                    // divides by a meeting count — round for display, never recompute it.
                    Math.Round(activity.AveragePresentPerMeeting, 1)),
                rows.CorrectiveActionCounts
                    .Select(r => new CorrectiveActionStatusCountDto(r.StatusName, r.CaseCount))
                    .ToList());

            return TypedResults.Ok(dto);
        }
        catch (DashboardException ex)
        {
            // usp_Dashboard_GetChapterSummary only ever rejects a caller who is not an
            // undeleted member of the chapter — unreachable in the normal case, since
            // IScopeGuard already confirmed the caller's own chapter matches the route,
            // but the procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }
}
