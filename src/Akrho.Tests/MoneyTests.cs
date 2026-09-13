using Akrho.Domain;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

public class MoneyTests
{
    [Fact]
    public void Split_of_the_standard_fee_is_exact()
    {
        var parts = Money.Split(50m, [40m, 30m, 20m, 10m]);
        parts.Should().Equal(20m, 15m, 10m, 5m);
        parts.Sum().Should().Be(50m);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(550)]
    [InlineData(21_032 * 50)]
    public void Split_never_loses_a_centavo(decimal total)
        => Money.Split(total, [40m, 30m, 20m, 10m]).Sum().Should().Be(total);

    [Fact]
    public void Split_absorbs_rounding_into_the_largest_share()
    {
        // 33.33 / 3 shares that do not divide evenly
        var parts = Money.Split(0.05m, [40m, 30m, 20m, 10m]);
        parts.Sum().Should().Be(0.05m);
    }

    [Fact]
    public void Split_rejects_shares_that_do_not_total_one_hundred()
    {
        var act = () => Money.Split(100m, [50m, 30m]);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Format_uses_the_peso_sign_and_two_decimals()
        => Money.Format(38420m).Should().Be("₱38,420.00");

    [Theory]
    [InlineData(400, "Four hundred pesos only")]
    [InlineData(1, "One peso only")]
    [InlineData(1_050, "One thousand fifty pesos only")]
    [InlineData(21_032, "Twenty-one thousand thirty-two pesos only")]
    public void InWords_reads_the_way_a_receipt_should(decimal amount, string expected)
        => Money.InWords(amount).Should().Be(expected);

    [Fact]
    public void InWords_includes_centavos()
        => Money.InWords(400.25m).Should().Be("Four hundred pesos and twenty-five centavos only");
}
