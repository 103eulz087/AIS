using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * Payment tags in the office permission grid (2026-10-18) — structural checks, no database.
 * usp_MemberPaymentTag_ListMembers/_GetStats/_Set used to be hardcoded to "CouncilAdmin seated
 * on National"; they now check the National-only grid keys MemberPaymentTag.Read/.Set on a
 * National seat (db/schema/29_payment_tag_permissions.sql).
 */
public class PaymentTagPermissionStructuralTests
{
    private static string Read(params string[] parts)
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        return File.ReadAllText(Path.Combine(new[] { root! }.Concat(parts).ToArray()));
    }

    [Theory]
    [InlineData("usp_MemberPaymentTag_ListMembers.sql", "MemberPaymentTag.Read")]
    [InlineData("usp_MemberPaymentTag_GetStats.sql", "MemberPaymentTag.Read")]
    [InlineData("usp_MemberPaymentTag_Set.sql", "MemberPaymentTag.Set")]
    public void Each_proc_checks_its_grid_key_on_a_National_seat(string file, string key)
    {
        var src = Read("db", "procs", file);
        src.Should().Contain("dbo.fn_MemberSeatPermissions(@RequestingMemberId)")
            .And.Contain($"sp.CouncilId = @NationalCouncilId AND sp.PermissionKey = N'{key}'");
        src.Should().NotContain("r.RoleName = 'CouncilAdmin'", "the grid, not a hardcoded role, decides who may act");
    }

    [Fact]
    public void Both_keys_are_National_only_Set_requires_Read_and_only_the_President_holds_them_by_default()
    {
        var src = Read("db", "schema", "29_payment_tag_permissions.sql");
        src.Should().Contain("N'MemberPaymentTag.Read', N'View payment tags'")
            .And.Contain("N'MemberPaymentTag.Set', N'Update payment tags'")
            .And.Contain("1, 1, 1, N'MemberPaymentTag.Read', 80, 1)");
        src.Should().Contain("(N'President', N'MemberPaymentTag.Read')")
            .And.Contain("(N'President', N'MemberPaymentTag.Set')");
        src.Should().NotContain("(N'Treasurer'").And.NotContain("(N'Secretary'");
    }

    [Fact]
    public void Report_has_its_own_National_only_key_President_by_default_and_the_report_proc_checks_it()
    {
        var schema = Read("db", "schema", "32_payment_report_permission.sql");
        schema.Should().Contain("N'MemberPaymentTag.Report', N'View payment report'")
            .And.Contain("0, 1, 1, NULL, 85, 1)")
            .And.Contain("SELECT co.CouncilOfficeId, N'MemberPaymentTag.Report'")
            .And.Contain("WHERE  co.OfficeName = N'President'");

        var proc = Read("db", "procs", "usp_MemberPaymentTag_GetReport.sql");
        proc.Should().Contain("sp.CouncilId = @NationalCouncilId AND sp.PermissionKey = N'MemberPaymentTag.Report'");
        proc.Should().NotContain("r.RoleName = 'CouncilAdmin'");
        // Counts only: no names, mobile numbers or contact details leave this procedure.
        proc.Should().NotContain("GiftName").And.NotContain("MobileNo").And.NotContain("FirstName");
    }

    [Fact]
    public void The_report_endpoint_reads_the_new_procedure_with_the_columns_in_its_order()
    {
        var repo = Read("src", "Akrho.Infrastructure", "Repositories", "MemberPaymentTagRepository.cs");
        repo.Should().Contain("\"dbo.usp_MemberPaymentTag_GetReport\"");
        repo.Should().Contain("int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName,");
        Read("db", "procs", "usp_MemberPaymentTag_GetReport.sql").Should().Contain(
            "SELECT  ch.ChapterId, ch.ChapterName,\n            pl.RegionName, pl.ProvinceName, pl.CityName,\n            k.TotalMembers, k.PaidCount, k.FreeCount, k.UnpaidCount,");
    }

    [Fact]
    public void Report_drill_down_needs_View_payment_tags_and_never_returns_contact_details()
    {
        var proc = Read("db", "procs", "usp_MemberPaymentTag_ListForReport.sql");
        proc.Should().Contain("sp.CouncilId = @NationalCouncilId AND sp.PermissionKey = N'MemberPaymentTag.Read'");
        var select = proc[proc.LastIndexOf("SELECT  MemberId, MemberNumber", StringComparison.Ordinal)..];
        select.Should().NotContain("MobileNo").And.NotContain("Email").And.NotContain("Address");
        // Same counting rule as the report, so the list adds up to the number clicked.
        proc.Should().Contain("CASE la.ActionType WHEN 'Tagged' THEN N'Paid' WHEN 'Free' THEN N'Free' ELSE N'Unpaid' END");
        var repo = Read("src", "Akrho.Infrastructure", "Repositories", "MemberPaymentTagRepository.cs");
        repo.Should().Contain("\"dbo.usp_MemberPaymentTag_ListForReport\"");
        select.Should().Contain("SELECT  MemberId, MemberNumber, GiftName, FullName,\n            ChapterId, ChapterName, RegionName, ProvinceName, CityName,\n            PaymentStatus, TaggedDate, TaggedByGiftName,");
    }
}
