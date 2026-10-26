using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * The Council Statistics map (2026-10-26) — structural checks, no database.
 * usp_CouncilStatistics_GetMap must scope exactly like usp_CouncilStatistics_Get
 * (invariant #4), return counts only (invariant #7), and keep every chapter in the totals.
 */
public class CouncilStatisticsMapStructuralTests
{
    private static string Read(params string[] parts)
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        return File.ReadAllText(Path.Combine(new[] { root! }.Concat(parts).ToArray()));
    }

    private static string Map() => Read("db", "procs", "usp_CouncilStatistics_GetMap.sql");

    [Fact]
    public void Scopes_exactly_like_the_statistics_screen()
    {
        var map = Map();
        map.Should().Contain("fn_MemberPermissionScope(@RequestingMemberId, N'CouncilStatistics.Read')")
            .And.Contain("THROW 51620").And.Contain("THROW 51621")
            .And.Contain("ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(@FocusCouncilId))");
    }

    [Fact]
    public void Returns_counts_only_never_names_or_contact_details()
    {
        var output = Map()[Map().LastIndexOf("SELECT  r.RegionCode, p.ProvinceCode", StringComparison.Ordinal)..];
        output.Should().NotContain("GiftName").And.NotContain("FirstName").And.NotContain("MobileNo").And.NotContain("ChapterName");
        output.Should().Contain("COUNT(m.MemberId) AS Members").And.Contain("COUNT(ua.AccountId) AS AppUsers");
    }

    [Fact]
    public void A_chapter_with_no_place_is_still_counted_so_totals_reconcile()
    {
        var map = Map();
        // LEFT joins to Region/Province: a chapter with no geography lands in the NULL/NULL row.
        map.Should().Contain("LEFT JOIN dbo.Region r     ON r.RegionId = c.RegionId")
            .And.Contain("LEFT JOIN dbo.Province p   ON p.ProvinceId = c.ProvinceId")
            .And.Contain("GROUP BY r.RegionCode, p.ProvinceCode");
    }

    [Fact]
    public void Endpoints_go_through_the_statistics_policy_and_the_new_procedure()
    {
        var endpoints = Read("src", "Akrho.Api", "Features", "CouncilStatistics", "CouncilStatisticsEndpoints.cs");
        endpoints.Should().Contain("\"/statistics/map\"").And.Contain("\"/{councilId:int}/statistics/map\"");
        var mapRoutes = endpoints[endpoints.IndexOf("\"/statistics/map\"", StringComparison.Ordinal)..];
        mapRoutes.Should().Contain("RequireAuthorization(AuthorizationPolicies.CouncilStatisticsRead)");
        Read("src", "Akrho.Infrastructure", "Repositories", "CouncilStatisticsRepository.cs")
            .Should().Contain("\"dbo.usp_CouncilStatistics_GetMap\"");
    }
}
