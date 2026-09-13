using Akrho.Api.Common;
using Akrho.Domain;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Members;

public static class MembersEndpoints
{
    public static IEndpointRouteBuilder MapMembers(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/members").WithTags("Members").RequireAuthorization();
        g.MapGet("", Search).WithName("SearchMembers");
        return app;
    }

    private static async Task<Results<Ok<PagedResult<object>>, ValidationProblem>> Search(
        [AsParameters] MemberSearchRequest req,
        IMemberRepository repo,
        ICurrentUser caller,
        IValidator<MemberSearchRequest> validator,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var rows = await repo.SearchAsync(
            caller.MemberId, req.ChapterId, req.Search, req.BloodTypeId,
            req.SkillId, req.IncludeInactive, req.Skip, req.Take, ct);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Two shapes. Choosing the wrong one is a privacy incident, not a bug.
        var items = rows.Select(object (r) => r.IsSameChapter
            ? new MemberDto(
                r.MemberId, r.GiftName, r.MemberNumber, r.ChapterId, r.ChapterName, r.StatusName,
                FullName: string.Join(' ', new[] { r.FirstName, r.MiddleName, r.LastName }
                                              .Where(s => !string.IsNullOrWhiteSpace(s))),
                r.MobileNo, r.Profession, r.BloodType,
                PhotoUrl: r.PhotoPath is null ? null : $"/api/files/{r.PhotoPath}",
                RenewedThrough: r.RenewedThrough is { } d ? DateOnly.FromDateTime(d) : null,
                IsCurrent: MembershipYear.IsCurrent(
                    r.RenewedThrough is { } dd ? DateOnly.FromDateTime(dd) : null, today))
            : new MemberCrossChapterDto(
                r.MemberId, r.GiftName, r.ChapterId, r.ChapterName, r.StatusName))
            .ToList();

        var total = rows.Count > 0 ? rows[0].TotalCount : 0;
        return TypedResults.Ok(new PagedResult<object>(items, total, req.Skip, req.Take));
    }
}
