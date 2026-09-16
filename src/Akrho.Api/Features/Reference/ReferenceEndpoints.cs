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

        // Public, unauthenticated — unlike every lookup above, these feed the chapter/council
        // registration module (a later module; docs §4.1, §7A), which happens BEFORE any
        // account exists, same reasoning as GET /api/chapters (MembersEndpoints/Apply.tsx).
        // Nothing sensitive here either way: public PH geography, not member data.
        app.MapGet("/api/regions", ListRegions).WithName("ListRegions").WithTags("Reference");

        app.MapGet("/api/provinces", ListProvinces).WithName("ListProvinces").WithTags("Reference");

        app.MapGet("/api/municipalities", ListMunicipalities).WithName("ListMunicipalities").WithTags("Reference");

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

    private static async Task<Ok<IReadOnlyList<RegionDto>>> ListRegions(
        IReferenceRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListRegionsAsync(ct);
        IReadOnlyList<RegionDto> items = rows.Select(r => new RegionDto(r.RegionId, r.RegionCode, r.RegionName)).ToList();
        return TypedResults.Ok(items);
    }

    private static async Task<Ok<IReadOnlyList<ProvinceDto>>> ListProvinces(
        int? regionId, IReferenceRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListProvincesAsync(regionId, ct);
        IReadOnlyList<ProvinceDto> items =
            rows.Select(r => new ProvinceDto(r.ProvinceId, r.RegionId, r.ProvinceCode, r.ProvinceName)).ToList();
        return TypedResults.Ok(items);
    }

    private static async Task<Ok<IReadOnlyList<MunicipalityDto>>> ListMunicipalities(
        int? provinceId, IReferenceRepository repo, CancellationToken ct)
    {
        var rows = await repo.ListMunicipalitiesAsync(provinceId, ct);
        IReadOnlyList<MunicipalityDto> items = rows.Select(r =>
            new MunicipalityDto(r.MunicipalityId, r.ProvinceId, r.MunicipalityCode, r.MunicipalityName, r.ZipCode)).ToList();
        return TypedResults.Ok(items);
    }
}
