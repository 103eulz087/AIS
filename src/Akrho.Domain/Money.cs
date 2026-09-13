using System.Globalization;

namespace Akrho.Domain;

/// <summary>
/// Money helpers. Every amount in this system is <see cref="decimal"/> and PHP.
/// Never <c>float</c>, never <c>double</c> — a lost centavo in a transparency system
/// is an argument at the next chapter meeting.
/// </summary>
public static class Money
{
    private static readonly CultureInfo Ph = CultureInfo.GetCultureInfo("en-PH");

    public static string Format(decimal amount) =>
        "₱" + amount.ToString("N2", Ph);

    /// <summary>
    /// Splits an amount by percentage shares so the parts sum EXACTLY to the total.
    /// The largest share absorbs the rounding remainder — otherwise ₱50 split
    /// 40/30/20/10 across thousands of members quietly loses centavos.
    /// </summary>
    public static IReadOnlyList<decimal> Split(decimal total, IReadOnlyList<decimal> percents)
    {
        ArgumentNullException.ThrowIfNull(percents);
        if (percents.Count == 0) return [];
        if (Math.Abs(percents.Sum() - 100m) > 0.001m)
            throw new ArgumentException("Shares must total 100 percent.", nameof(percents));

        var parts = percents.Select(p => Math.Round(total * p / 100m, 2, MidpointRounding.ToEven)).ToArray();
        var remainder = total - parts.Sum();
        if (remainder != 0)
        {
            var largest = 0;
            for (var i = 1; i < parts.Length; i++)
                if (percents[i] > percents[largest]) largest = i;
            parts[largest] += remainder;
        }
        return parts;
    }

    /// <summary>Amount in words, for the acknowledgement receipt. "Four hundred pesos only".</summary>
    public static string InWords(decimal amount)
    {
        var whole = (long)Math.Truncate(amount);
        var centavos = (int)Math.Round((amount - whole) * 100m, 0);
        var words = Spell(whole);
        var text = $"{Capitalise(words)} peso{(whole == 1 ? "" : "s")}";
        if (centavos > 0) text += $" and {Spell(centavos)} centavo{(centavos == 1 ? "" : "s")}";
        return text + " only";
    }

    private static string Capitalise(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];

    private static string Spell(long n)
    {
        if (n == 0) return "zero";
        string[] ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                         "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
                         "seventeen", "eighteen", "nineteen"];
        string[] tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

        if (n < 20) return ones[n];
        if (n < 100) return tens[n / 10] + (n % 10 > 0 ? "-" + ones[n % 10] : "");
        if (n < 1_000) return ones[n / 100] + " hundred" + (n % 100 > 0 ? " " + Spell(n % 100) : "");
        if (n < 1_000_000) return Spell(n / 1_000) + " thousand" + (n % 1_000 > 0 ? " " + Spell(n % 1_000) : "");
        return Spell(n / 1_000_000) + " million" + (n % 1_000_000 > 0 ? " " + Spell(n % 1_000_000) : "");
    }
}
