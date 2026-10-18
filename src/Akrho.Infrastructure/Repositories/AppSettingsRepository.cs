using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum AppSettingsErrorCategory { Forbidden, BadRequest }

/// <summary>
/// Thrown when usp_AppSettings_Get or usp_AppSettings_Set rejects a call (51950-51953). The
/// messages were written in the procedure for the National officer reading the screen, so
/// they are surfaced as-is, same convention as every other feature exception here.
/// </summary>
public sealed class AppSettingsException : Exception
{
    public AppSettingsErrorCategory Category { get; }

    public AppSettingsException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // Caller does not hold AppSettings.Manage on a National seat.
            51950 => AppSettingsErrorCategory.Forbidden,
            // 51951-51953: on/off missing, days out of range, unrecognised feature key.
            _ => AppSettingsErrorCategory.BadRequest
        };
    }
}

internal static class AppSettingsErrors
{
    private static readonly HashSet<int> Known = [51950, 51951, 51952, 51953];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>Result set 1 of usp_MemberAccess_Get. Dates arrive as DateTime (SQL DATE).</summary>
public sealed record MemberAccessRow(
    bool IsTrialEnabled, int TrialDays, DateTime? TrialStartedOn, DateTime? TrialEndsOn,
    int TrialDaysLeft, bool IsPaid, bool IsLocked, int MembershipYear);

/// <summary>Result set 2 of usp_MemberAccess_Get.</summary>
public sealed record MemberAccessFeatureRow(string FeatureKey, string DisplayName, bool IsOpen);

public sealed record MemberAccessRows(MemberAccessRow Access, IReadOnlyList<MemberAccessFeatureRow> Features);

/// <summary>Result set 1 of usp_AppSettings_Get.</summary>
public sealed record AppSettingsHeaderRow(
    bool IsTrialEnabled, int TrialDays, string? UpdatedByGiftName, DateTime? UpdatedDate);

/// <summary>Result set 2 of usp_AppSettings_Get.</summary>
public sealed record AppSettingsFeatureRow(
    string FeatureKey, string DisplayName, string Description, bool IsAlwaysOpen, bool IsOpenAfterTrial);

/// <summary>Result set 3 of usp_AppSettings_Get — counts only, never names.</summary>
public sealed record AppSettingsPreviewRow(
    int TotalMembers, int PaidMembers, int InTrialMembers, int TrialOverMembers);

public sealed record AppSettingsRows(
    AppSettingsHeaderRow Header,
    IReadOnlyList<AppSettingsFeatureRow> Features,
    AppSettingsPreviewRow Preview);

public interface IAppSettingsRepository
{
    /// <summary>The caller's own free-trial state and open features. Always and only his own
    /// data, so no scoping check is needed (invariant #4 trivially holds).</summary>
    Task<MemberAccessRows> GetAccessAsync(int memberId, CancellationToken ct);

    /// <summary>National settings screen. Throws <see cref="AppSettingsException"/> (Forbidden)
    /// unless the caller holds AppSettings.Manage on a National seat.</summary>
    Task<AppSettingsRows> GetSettingsAsync(int requestingMemberId, CancellationToken ct);

    /// <summary>Saves everything at once; any feature not listed is closed after the trial
    /// (Announcements stays open regardless). Audited by the procedure.</summary>
    Task SetSettingsAsync(
        int requestingMemberId, bool isTrialEnabled, int trialDays,
        IReadOnlyList<string> openFeatureKeys, CancellationToken ct);
}

public sealed class AppSettingsRepository(ISqlConnectionFactory factory) : IAppSettingsRepository
{
    public async Task<MemberAccessRows> GetAccessAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            "dbo.usp_MemberAccess_Get",
            new { MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));

        var access = await multi.ReadSingleAsync<MemberAccessRow>();
        var features = (await multi.ReadAsync<MemberAccessFeatureRow>()).ToList();
        return new MemberAccessRows(access, features);
    }

    public async Task<AppSettingsRows> GetSettingsAsync(int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_AppSettings_Get",
                new { RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<AppSettingsHeaderRow>();
            var features = (await multi.ReadAsync<AppSettingsFeatureRow>()).ToList();
            var preview = await multi.ReadSingleAsync<AppSettingsPreviewRow>();
            return new AppSettingsRows(header, features, preview);
        }
        catch (SqlException ex) when (AppSettingsErrors.IsKnown(ex.Number))
        {
            throw new AppSettingsException(ex.Number, ex.Message);
        }
    }

    public async Task SetSettingsAsync(
        int requestingMemberId, bool isTrialEnabled, int trialDays,
        IReadOnlyList<string> openFeatureKeys, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_AppSettings_Set",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    IsTrialEnabled = isTrialEnabled,
                    TrialDays = trialDays,
                    OpenFeatureKeys = string.Join(',', openFeatureKeys)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (AppSettingsErrors.IsKnown(ex.Number))
        {
            throw new AppSettingsException(ex.Number, ex.Message);
        }
    }
}
