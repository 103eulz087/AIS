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
}
