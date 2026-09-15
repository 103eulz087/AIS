using System.Data;
using Dapper;

namespace Akrho.Infrastructure.Repositories;

public sealed record BloodTypeRow(int BloodTypeId, string BloodTypeName);

public sealed record SkillRow(int SkillId, string SkillName);

public sealed record CorrectiveActionCategoryRow(int CategoryId, string CategoryName);

/// <summary>
/// Small reference-data lookups with no scoping and no sensitivity of their own (only a
/// MEMBER'S OWN blood type is sensitive — docs §8 — never the list of possible values). Feeds
/// the profile editor's dropdowns (blood type, skills).
/// </summary>
public interface IReferenceRepository
{
    Task<IReadOnlyList<BloodTypeRow>> ListBloodTypesAsync(CancellationToken ct);

    /// <summary>Active skills only — the controlled tag list (docs §4.2).</summary>
    Task<IReadOnlyList<SkillRow>> ListSkillsAsync(CancellationToken ct);

    /// <summary>The corrective-action category list (docs §4.5) — feeds the "file a case" form.</summary>
    Task<IReadOnlyList<CorrectiveActionCategoryRow>> ListCorrectiveActionCategoriesAsync(CancellationToken ct);
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
}
