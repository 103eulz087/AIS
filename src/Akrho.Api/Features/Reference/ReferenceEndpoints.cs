using Akrho.Infrastructure.Repositories;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Reference;

/// <summary>
/// Small reference-data lookups feeding the self-service profile editor's dropdowns. Every
/// signed-in member needs these to render the form — no special policy beyond "authenticated",
/// and no scoping: the LIST of blood types/skills carries nothing sensitive (only a member's
/// OWN selected blood type does, docs §8).
/// </summary>
public static class ReferenceEndpoints
{
    public static IEndpointRouteBuilder MapReference(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/blood-types", ListBloodTypes)
            .WithName("ListBloodTypes").WithTags("Reference").RequireAuthorization();

        app.MapGet("/api/skills", ListSkills)
            .WithName("ListSkills").WithTags("Reference").RequireAuthorization();

        app.MapGet("/api/corrective-action-categories", ListCorrectiveActionCategories)
            .WithName("ListCorrectiveActionCategories").WithTags("Reference").RequireAuthorization();

        return app;
    }

    private static async Task<Ok<IReadOnlyList<BloodTypeDto>>> ListBloodTypes(
        IReferenceRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListBloodTypesAsync(ct);
        IReadOnlyList<BloodTypeDto> items = rows.Select(r => new BloodTypeDto(r.BloodTypeId, r.BloodTypeName)).ToList();
        return TypedResults.Ok(items);
    }

    private static async Task<Ok<IReadOnlyList<SkillDto>>> ListSkills(
        IReferenceRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListSkillsAsync(ct);
        IReadOnlyList<SkillDto> items = rows.Select(r => new SkillDto(r.SkillId, r.SkillName)).ToList();
        return TypedResults.Ok(items);
    }

    private static async Task<Ok<IReadOnlyList<CorrectiveActionCategoryDto>>> ListCorrectiveActionCategories(
        IReferenceRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListCorrectiveActionCategoriesAsync(ct);
        IReadOnlyList<CorrectiveActionCategoryDto> items =
            rows.Select(r => new CorrectiveActionCategoryDto(r.CategoryId, r.CategoryName)).ToList();
        return TypedResults.Ok(items);
    }
}
