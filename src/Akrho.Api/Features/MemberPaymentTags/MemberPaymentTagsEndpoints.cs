using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.MemberPaymentTags;

/// <summary>
/// National Council's payment-tagging module (client decision 2026-09-29) — search a
/// chapter (via the existing GET /api/chapters/search-jurisdiction) OR a member directly
/// (added 2026-10-06), see the matching member list, and tag Paid/Unpaid/Free (tri-state,
/// added 2026-10-06) for whoever has paid, is exempt, or hasn't paid this membership
/// year. See db/schema/25_member_payment_tag.sql's own header for why this is
/// deliberately separate from the existing RenewalPeriod/ChapterRenewal/MemberRenewal/
/// AckReceipt module. GET /api/member-payment-tags/stats (added 2026-10-06) is the
/// Paid/Unpaid/Free report alongside it.
/// </summary>
public static class MemberPaymentTagsEndpoints
{
    public static IEndpointRouteBuilder MapMemberPaymentTags(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/member-payment-tags").WithTags("MemberPaymentTags")
            .RequireAuthorization(AuthorizationPolicies.MemberPaymentTagManage);

        // Replaces the old chapter-only GET /chapters/{chapterId}/members (2026-10-06) —
        // chapterId is now an optional query filter, not a route segment, since a direct
        // national-wide member search (no chapter at all) is now just as valid a call.
        g.MapGet("/members", ListMembers).WithName("ListMemberPaymentTags");
        g.MapPost("/members/{memberId:int}", SetMemberPaymentTag).WithName("SetMemberPaymentTag");
        g.MapGet("/stats", GetStats).WithName("GetMemberPaymentTagStats");

        return app;
    }

    private static async Task<Results<Ok<IReadOnlyList<MemberPaymentTagMemberDto>>, ProblemHttpResult>> ListMembers(
        IMemberPaymentTagRepository repo, ICurrentUser caller, CancellationToken ct,
        int? chapterId, string? search, string? status, int? membershipYear,
        // Plain (non-nullable) query parameters are REQUIRED by minimal-API binding unless
        // given a default here — found live: omitting skip/take from the query string 500'd
        // instead of falling back to these.
        int skip = 0, int take = 50)
    {
        try
        {
            var rows = await repo.ListMembersAsync(
                caller.MemberId, chapterId, search, status, membershipYear,
                skip, take, ct);
            IReadOnlyList<MemberPaymentTagMemberDto> items = rows
                .Select(r => new MemberPaymentTagMemberDto(
                    r.MemberId, r.MemberNumber, r.GiftName,
                    FullName: string.Join(' ', new[] { r.FirstName, r.MiddleName, r.LastName }
                                                  .Where(s => !string.IsNullOrWhiteSpace(s))),
                    r.MobileNo, r.ChapterId, r.ChapterName,
                    r.StatusName, r.PaymentStatus, r.TaggedDate, r.TaggedByGiftName, r.MembershipYear))
                .ToList();
            return TypedResults.Ok(items);
        }
        catch (MemberPaymentTagException ex)
        {
            return ex.Category switch
            {
                MemberPaymentTagErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                MemberPaymentTagErrorCategory.NotFound =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status404NotFound),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok<MemberPaymentTagResultDto>, ProblemHttpResult>> SetMemberPaymentTag(
        int memberId, SetMemberPaymentTagRequest req,
        IMemberPaymentTagRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            await repo.SetAsync(caller.MemberId, memberId, req.Status, req.MembershipYear, ct);
            var membershipYear = req.MembershipYear ?? Akrho.Domain.MembershipYear.YearFor(DateOnly.FromDateTime(DateTime.UtcNow));
            return TypedResults.Ok(new MemberPaymentTagResultDto(memberId, req.Status, membershipYear));
        }
        catch (MemberPaymentTagException ex)
        {
            return ex.Category switch
            {
                MemberPaymentTagErrorCategory.NotFound =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status404NotFound),
                MemberPaymentTagErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok<IReadOnlyList<MemberPaymentTagStatsDto>>, ProblemHttpResult>> GetStats(
        int? chapterId, int? membershipYear,
        IMemberPaymentTagRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var rows = await repo.GetStatsAsync(caller.MemberId, chapterId, membershipYear, ct);
            IReadOnlyList<MemberPaymentTagStatsDto> items = rows
                .Select(r => new MemberPaymentTagStatsDto(
                    r.ChapterId, r.ChapterName, r.TotalMembers,
                    r.PaidCount, r.FreeCount, r.UnpaidCount, r.MembershipYear))
                .ToList();
            return TypedResults.Ok(items);
        }
        catch (MemberPaymentTagException ex)
        {
            return ex.Category switch
            {
                MemberPaymentTagErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                MemberPaymentTagErrorCategory.NotFound =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status404NotFound),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }
}
