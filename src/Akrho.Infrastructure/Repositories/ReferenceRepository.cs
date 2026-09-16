using System.Data;
using Dapper;

namespace Akrho.Infrastructure.Repositories;

public sealed record BloodTypeRow(int BloodTypeId, string BloodTypeName);

public sealed record SkillRow(int SkillId, string SkillName);

public sealed record CorrectiveActionCategoryRow(int CategoryId, string CategoryName);

public sealed record RegionRow(int RegionId, string RegionCode, string RegionName);

public sealed record ProvinceRow(int ProvinceId, int RegionId, short ProvinceCode, string ProvinceName);

public sealed record MunicipalityRow(int MunicipalityId, int ProvinceId, short MunicipalityCode, string MunicipalityName, string? ZipCode);

/// <summary>
/// Small reference-data lookups with no scoping and no sensitivity of their own (only a
/// MEMBER'S OWN blood type is sensitive — docs §8 — never the list of possible values). Feeds
/// the profile editor's dropdowns (blood type, skills), and — Region/Province/Municipality —
/// the cascading location picker on the chapter/council registration module (a later module;
/// see db/schema/16_geography.sql).
/// </summary>
public interface IReferenceRepository
{
    Task<IReadOnlyList<BloodTypeRow>> ListBloodTypesAsync(CancellationToken ct);

    /// <summary>Active skills only — the controlled tag list (docs §4.2).</summary>
    Task<IReadOnlyList<SkillRow>> ListSkillsAsync(CancellationToken ct);

    /// <summary>The corrective-action category list (docs §4.5) — feeds the "file a case" form.</summary>
    Task<IReadOnlyList<CorrectiveActionCategoryRow>> ListCorrectiveActionCategoriesAsync(CancellationToken ct);

    /// <summary>Every PH region. Feeds the first level of the cascade.</summary>
    Task<IReadOnlyList<RegionRow>> ListRegionsAsync(CancellationToken ct);

    /// <summary>Provinces in one region — or every province if <paramref name="regionId"/> is null.</summary>
    Task<IReadOnlyList<ProvinceRow>> ListProvincesAsync(int? regionId, CancellationToken ct);

    /// <summary>Cities/municipalities in one province — or every one if <paramref name="provinceId"/> is null.</summary>
    Task<IReadOnlyList<MunicipalityRow>> ListMunicipalitiesAsync(int? provinceId, CancellationToken ct);
}

public sealed class ReferenceRepository(ISqlConnectionFactory factory) : IReferenceRepository
{
    public async Task<IReadOnlyList<BloodTypeRow>> ListBloodTypesAsync(CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<BloodTypeRow>(new CommandDefinition(
            "dbo.usp_BloodType_List",
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<SkillRow>> ListSkillsAsync(CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<SkillRow>(new CommandDefinition(
            "dbo.usp_Skill_List",
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<CorrectiveActionCategoryRow>> ListCorrectiveActionCategoriesAsync(CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<CorrectiveActionCategoryRow>(new CommandDefinition(
            "dbo.usp_CorrectiveActionCategory_List",
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<RegionRow>> ListRegionsAsync(CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<RegionRow>(new CommandDefinition(
            "dbo.usp_Region_List",
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<ProvinceRow>> ListProvincesAsync(int? regionId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<ProvinceRow>(new CommandDefinition(
            "dbo.usp_Province_List", new { RegionId = regionId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<MunicipalityRow>> ListMunicipalitiesAsync(int? provinceId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var rows = await conn.QueryAsync<MunicipalityRow>(new CommandDefinition(
            "dbo.usp_Municipality_List", new { ProvinceId = provinceId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return rows.ToList();
    }
}
