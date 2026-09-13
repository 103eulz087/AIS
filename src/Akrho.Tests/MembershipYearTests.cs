using Akrho.Domain;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

public class MembershipYearTests
{
    [Fact]
    public void Year_ends_on_8_August_of_the_following_calendar_year()
        => MembershipYear.EndsOn(2027).Should().Be(new DateOnly(2028, 8, 8));

    [Fact]
    public void Year_starts_on_9_August()
        => MembershipYear.StartsOn(2027).Should().Be(new DateOnly(2027, 8, 9));

    [Theory]
    [InlineData(2027, 8, 8, 2026)]   // the 8th still belongs to the year that opened in 2026
    [InlineData(2027, 8, 9, 2027)]   // the 9th opens the 2027 year
    [InlineData(2028, 1, 15, 2027)]  // January falls in the year that opened the previous August
    public void YearFor_uses_the_opening_year(int y, int m, int d, int expected)
        => MembershipYear.YearFor(new DateOnly(y, m, d)).Should().Be(expected);

    [Fact]
    public void Card_is_current_up_to_and_including_8_August()
    {
        var through = new DateOnly(2028, 8, 8);
        MembershipYear.IsCurrent(through, new DateOnly(2028, 8, 8)).Should().BeTrue();
        MembershipYear.IsCurrent(through, new DateOnly(2028, 8, 9)).Should().BeFalse();
    }

    [Fact]
    public void Never_renewed_is_never_current()
        => MembershipYear.IsCurrent(null, new DateOnly(2027, 1, 1)).Should().BeFalse();

    [Fact]
    public void Label_shows_the_span() => MembershipYear.Label(2027).Should().Be("2027–28");
}
