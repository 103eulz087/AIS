using Akrho.Infrastructure.Security;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Scope leakage is the worst failure this system can have: one missed check exposes
/// another chapter's financial records. These tests come first for that reason.
/// </summary>
public class ScopeGuardTests
{
    private sealed record FakeUser(int MemberId, int ChapterId, IReadOnlySet<string> Roles) : ICurrentUser
    {
        public bool IsChapterOfficer =>
            Roles.Overlaps(["ChapterOfficer", "ChapterTreasurer", "ChapterAdmin"]);
        public bool IsCouncilOfficer => Roles.Contains("CouncilSecretary");
    }

    private static ICurrentUser Member(int id, int chapter) =>
        new FakeUser(id, chapter, new HashSet<string> { "Member" });

    private static ICurrentUser Officer(int id, int chapter) =>
        new FakeUser(id, chapter, new HashSet<string> { "Member", "ChapterAdmin" });

    private readonly ScopeGuard _guard = new();

    [Fact]
    public void Member_may_read_his_own_chapter()
    {
        var act = () => _guard.EnsureChapter(Member(1, 10), 10);
        act.Should().NotThrow();
    }

    [Fact]
    public void Member_cannot_read_another_chapter_even_by_asking_for_it()
    {
        var act = () => _guard.EnsureChapter(Member(1, 10), 11);
        act.Should().Throw<ScopeViolationException>();
    }

    [Fact]
    public void Officer_of_one_chapter_has_no_reach_into_another()
    {
        var act = () => _guard.EnsureChapter(Officer(1, 10), 11);
        act.Should().Throw<ScopeViolationException>();
    }

    // Option B: everyone sees name, category, status, date — nobody else sees the narrative.
    [Fact]
    public void Ordinary_member_cannot_see_a_case_narrative_about_someone_else()
        => _guard.CanSeeCaseNarrative(Member(1, 10), subjectMemberId: 2, chapterId: 10)
                 .Should().BeFalse();

    [Fact]
    public void Member_can_see_the_narrative_of_his_own_case()
        => _guard.CanSeeCaseNarrative(Member(2, 10), subjectMemberId: 2, chapterId: 10)
                 .Should().BeTrue();

    [Fact]
    public void Officer_can_see_a_case_narrative_in_his_chapter()
        => _guard.CanSeeCaseNarrative(Officer(1, 10), subjectMemberId: 2, chapterId: 10)
                 .Should().BeTrue();

    [Fact]
    public void Officer_cannot_see_a_case_narrative_in_another_chapter()
        => _guard.CanSeeCaseNarrative(Officer(1, 10), subjectMemberId: 2, chapterId: 11)
                 .Should().BeFalse();
}
