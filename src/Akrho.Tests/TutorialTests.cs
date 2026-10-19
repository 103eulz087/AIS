using Akrho.Api.Features.Tutorials;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * First-login guided tours (2026-10-19): validator + structural checks, no database.
 * db/schema/31_member_tutorial.sql, usp_MemberTutorial_GetMine/_Finish,
 * Features/Tutorials/TutorialsEndpoints.cs.
 */
public class TutorialTests
{
    private static string Read(params string[] parts)
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        return File.ReadAllText(Path.Combine(new[] { root! }.Concat(parts).ToArray()));
    }

    [Theory]
    [InlineData(1, "Completed", true)]
    [InlineData(3, "Skipped", true)]
    [InlineData(0, "Completed", false)]
    [InlineData(1, "Done", false)]
    [InlineData(1, "completed", false)]
    public void Finish_request_validation(int version, string outcome, bool valid)
    {
        new FinishTutorialRequestValidator().Validate(new FinishTutorialRequest(version, outcome))
            .IsValid.Should().Be(valid);
    }

    [Fact]
    public void Endpoints_use_the_callers_own_member_id_and_are_never_trial_gated()
    {
        var src = Read("src", "Akrho.Api", "Features", "Tutorials", "TutorialsEndpoints.cs");
        src.Should().Contain("repo.GetMineAsync(caller.MemberId, ct)")
            .And.Contain("repo.FinishAsync(caller.MemberId, tourKey,");
        src.Should().NotContain(".RequireFeature(", "a member whose free trial is over still gets his tour");
        src.Should().Contain("MapGroup(\"/api/members/me/tutorials\")");
    }

    [Fact]
    public void Finish_is_audited_in_the_same_transaction_and_only_known_tours_are_accepted()
    {
        var src = Read("db", "procs", "usp_MemberTutorial_Finish.sql");
        var begin = src.IndexOf("BEGIN TRAN;", StringComparison.Ordinal);
        var audit = src.IndexOf("INSERT dbo.AuditLog", StringComparison.Ordinal);
        var commit = src.IndexOf("COMMIT;", StringComparison.Ordinal);
        audit.Should().BeGreaterThan(begin).And.BeLessThan(commit);
        src.Should().Contain("FROM dbo.Tutorial WHERE TourKey = @TourKey AND IsActive = 1");
    }

    [Fact]
    public void One_row_per_member_and_tour_with_a_checked_outcome()
    {
        var src = Read("db", "schema", "31_member_tutorial.sql");
        src.Should().Contain("PRIMARY KEY (MemberId, TourKey)")
            .And.Contain("CHECK (Outcome IN (N'Completed', N'Skipped'))")
            .And.Contain("(N'ais-welcome',").And.Contain("(N'portal-welcome',");
    }

    [Theory]
    [InlineData("guide-members")] [InlineData("guide-funds")] [InlineData("guide-announcements")]
    [InlineData("guide-digital-id")] [InlineData("guide-profile")] [InlineData("guide-meetings")]
    [InlineData("guide-money")] [InlineData("guide-post-announcement")] [InlineData("guide-approvals")]
    [InlineData("guide-portal-registrations")] [InlineData("guide-portal-seating")]
    [InlineData("guide-portal-permissions")] [InlineData("guide-portal-payments")]
    [InlineData("guide-portal-members")] [InlineData("guide-portal-settings")]
    public void Every_how_to_guide_is_in_the_catalogue(string key)
    {
        // usp_MemberTutorial_Finish rejects any key missing from dbo.Tutorial (51960), so a
        // guide shipped in the web app without its row here could never be marked done.
        Read("db", "schema", "33_how_to_guides.sql").Should().Contain($"(N'{key}',");
    }
}
