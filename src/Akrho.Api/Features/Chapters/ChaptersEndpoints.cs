using Akrho.Infrastructure.Repositories;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Chapters;

public static class ChaptersEndpoints
{
    public static IEndpointRouteBuilder MapChapters(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters").WithTags("Chapters");

        // Deliberately no RequireAuthorization() anywhere in this group. This is the public
        // sign-up form's cascading Region -> Province -> City -> Chapter picker (CLAUDE.md
        // §4.1 / §7A.4), reached from the login page before anyone has an account to sign in
        // with — there is no caller identity yet to authorize against.
        g.MapGet("", List).WithName("ListPublicChapters");

        return app;
    }

    private static async Task<Ok<IReadOnlyList<ChapterPublicDto>>> List(
        IChapterRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListPublicAsync(ct);
        IReadOnlyList<ChapterPublicDto> items = rows
            .Select(r => new ChapterPublicDto(r.ChapterId, r.ChapterName, r.RegionName, r.ProvinceName, r.CityName))
            .ToList();
        return TypedResults.Ok(items);
    }
}
