using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * Auto re-routing when a council loses its last officer (2026-10-18) — structural checks, no
 * database. usp_ChapterRegistration_RerouteFromDormant moves open Submitted registrations off
 * a council nobody is seated on past today, up to the nearest seated ancestor (invariant #13a's
 * dormancy case, applied after filing). usp_Council_UnseatOfficer calls it in its own
 * transaction; RegistrationRerouteHostedService sweeps hourly.
 */
public class RegistrationRerouteStructuralTests
{
    private static string Read(params string[] parts)
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        return File.ReadAllText(Path.Combine(new[] { root! }.Concat(parts).ToArray()));
    }

    private static string Reroute() => Read("db", "procs", "usp_ChapterRegistration_RerouteFromDormant.sql");

    [Fact]
    public void Unseat_reroutes_inside_its_own_transaction_after_closing_the_seat()
    {
        var src = Read("db", "procs", "usp_Council_Seating.sql");
        var unseat = src[src.IndexOf("CREATE OR ALTER PROCEDURE dbo.usp_Council_UnseatOfficer", StringComparison.Ordinal)..];
        unseat = unseat[..unseat.IndexOf("\nGO", StringComparison.Ordinal)];

        var update = unseat.IndexOf("UPDATE dbo.MemberRole SET TermEnd = @Today", StringComparison.Ordinal);
        var exec = unseat.IndexOf("EXEC dbo.usp_ChapterRegistration_RerouteFromDormant", StringComparison.Ordinal);
        var commit = unseat.IndexOf("COMMIT;", StringComparison.Ordinal);

        update.Should().BeGreaterThan(0);
        exec.Should().BeGreaterThan(update, "the seat must be closed before the council is judged empty");
        commit.Should().BeGreaterThan(exec, "re-routing is atomic with the unseat");
        unseat.Should().Contain("@CouncilId = @CouncilId").And.Contain("@ActorMemberId = @RequestingMemberId");
    }

    [Fact]
    public void Seated_means_still_seated_after_today()
    {
        // An unseat sets TermEnd = today; '>= @Today' would keep the council looking staffed.
        Regex.IsMatch(Reroute(), @"mr\.TermEnd\s+IS\s+NULL\s+OR\s+mr\.TermEnd\s*>\s*@Today").Should().BeTrue();
        Regex.IsMatch(Reroute(), @"mr\.TermEnd\s*>=\s*@Today").Should().BeFalse();
    }

    [Fact]
    public void Only_open_Submitted_registrations_move()
    {
        var src = Reroute();
        src.Should().Contain("cr.IsOpen = 1").And.Contain("s.StatusName = N'Submitted'");
    }

    [Fact]
    public void Every_move_is_recorded_in_routing_history_timeline_and_audit_log_in_one_transaction()
    {
        var src = Reroute();
        var begin = src.IndexOf("BEGIN TRAN;", StringComparison.Ordinal);
        var commit = src.IndexOf("COMMIT;", StringComparison.Ordinal);
        begin.Should().BeGreaterThan(0);

        foreach (var write in new[] { "UPDATE cr", "INSERT dbo.ApprovalRouting", "INSERT dbo.ChapterRegistrationUpdate", "INSERT dbo.AuditLog" })
        {
            var at = src.IndexOf(write, StringComparison.Ordinal);
            at.Should().BeGreaterThan(begin, $"{write} belongs inside the transaction");
            at.Should().BeLessThan(commit, $"{write} belongs inside the transaction");
        }
    }

    [Fact]
    public void Moves_only_upward_to_a_strict_ancestor()
    {
        // The walk starts at the stuck council's PARENT, never the council itself or a child.
        Reroute().Should().Contain("SELECT f.FromCouncilId, c.ParentCouncilId AS CouncilId, 1 AS Depth");
    }

    [Fact]
    public void Registration_detail_returns_only_the_latest_routing_record()
    {
        // ChapterRegistrationRepository reads this set with ReadSingleOrDefault; a second
        // routing row (from a re-route) must never reach it.
        var src = Read("db", "procs", "usp_ChapterRegistration_Get.sql");
        src.Should().Contain("SELECT  TOP (1) ar.RoutingId");
        src.Should().Contain("ORDER BY ar.ActedOn DESC, ar.RoutingId DESC");
    }

    [Fact]
    public void Hourly_sweep_is_registered()
    {
        Read("src", "Akrho.Api", "Program.cs")
            .Should().Contain("AddHostedService<Akrho.Infrastructure.Routing.RegistrationRerouteHostedService>()");
    }
}
