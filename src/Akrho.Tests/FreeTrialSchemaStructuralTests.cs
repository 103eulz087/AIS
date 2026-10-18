using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * Free trial (2026-10-18) — structural checks on the schema and procedures, no database.
 * db/schema/30_app_settings_free_trial.sql holds the one rule (dbo.fn_MemberAccess);
 * usp_MemberAccess_Get, usp_AppSettings_Get and usp_AppSettings_Set all read it from there.
 */
public class FreeTrialSchemaStructuralTests
{
    private static string Read(params string[] parts)
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        return File.ReadAllText(Path.Combine(new[] { root! }.Concat(parts).ToArray()));
    }

    private static string Schema() => Read("db", "schema", "30_app_settings_free_trial.sql");

    [Fact]
    public void Off_by_default_so_deploying_locks_nobody()
    {
        Schema().Should().Contain("VALUES (N'FreeTrial.Enabled', N'0')");
    }

    [Fact]
    public void Paid_means_the_same_as_the_Digital_ID_watermark_Tagged_or_Free_for_the_current_year()
    {
        var src = Schema();
        src.Should().Contain("lt.ActionType IN (N'Tagged', N'Free')")
            .And.Contain("a.MembershipYear = yr.MembershipYear")
            .And.Contain("DATEFROMPARTS(YEAR(cfg.Today), 8, 8)");
    }

    [Fact]
    public void Locked_only_when_on_unpaid_and_the_trial_from_approval_has_run_out()
    {
        var src = Schema();
        src.Should().Contain("COALESCE(mem.ApprovedDate, mem.CreatedDate)");
        var locked = src[src.IndexOf("CAST(CASE WHEN yr.IsTrialEnabled = 1", StringComparison.Ordinal)..];
        locked = locked[..locked.IndexOf("AS IsLocked", StringComparison.Ordinal)];
        locked.Should().Contain("m.IsPaid = 0").And.Contain("DATEADD(DAY, yr.TrialDays, m.TrialStartedOn) <= yr.Today");
    }

    [Fact]
    public void Announcements_can_never_be_closed()
    {
        Schema().Should().Contain("CHECK (IsAlwaysOpen = 0 OR IsOpenAfterTrial = 1)")
            .And.Contain("(N'Announcements',");
        Read("db", "procs", "usp_AppSettings_Set.sql").Should().Contain("f.IsAlwaysOpen = 1 OR o.FeatureKey IS NOT NULL");
        Read("db", "procs", "usp_MemberAccess_Get.sql").Should().Contain("@IsLocked = 0 OR f.IsAlwaysOpen = 1 OR f.IsOpenAfterTrial = 1");
    }

    [Fact]
    public void Settings_are_National_only_and_every_change_is_audited_in_the_same_transaction()
    {
        var set = Read("db", "procs", "usp_AppSettings_Set.sql");
        set.Should().Contain("sp.PermissionKey = N'AppSettings.Manage'");
        var begin = set.IndexOf("BEGIN TRAN;", StringComparison.Ordinal);
        var commit = set.IndexOf("COMMIT;", StringComparison.Ordinal);
        var audit = set.IndexOf("INSERT dbo.AuditLog", StringComparison.Ordinal);
        audit.Should().BeGreaterThan(begin).And.BeLessThan(commit);
        Read("db", "procs", "usp_AppSettings_Get.sql").Should().Contain("sp.PermissionKey = N'AppSettings.Manage'");
        Schema().Should().Contain("N'AppSettings.Manage', N'Manage app settings'").And.Contain("1, 1, 1, NULL, 90, 1)");
    }

    [Fact]
    public void Nothing_about_the_trial_computes_an_amount_owed()
    {
        // Invariant #5: the trial keys on the payment TAG only — no money anywhere.
        foreach (var src in new[] { Schema(), Read("db", "procs", "usp_MemberAccess_Get.sql"), Read("db", "procs", "usp_AppSettings_Get.sql") })
            src.Should().NotContainAny("DECIMAL", "Amount", "Arrears", "Contribution");
    }
}
