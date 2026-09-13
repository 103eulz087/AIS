namespace Akrho.Domain;

/// <summary>
/// The AKRHO membership year runs 09 August → 08 August, anchored on the organisation's
/// anniversary, and is named by the calendar year in which it OPENS.
/// The 2027 year covers 09 Aug 2027 to 08 Aug 2028.
/// </summary>
/// <remarks>
/// This convention cannot be changed once seals have been issued without reissuing every
/// card ever granted. Do not "simplify" it to a calendar year.
/// </remarks>
public static class MembershipYear
{
    public const int AnniversaryMonth = 8;
    public const int AnniversaryDay = 8;

    /// <summary>Last day a card issued for <paramref name="year"/> remains current.</summary>
    public static DateOnly EndsOn(int year) => new(year + 1, AnniversaryMonth, AnniversaryDay);

    /// <summary>First day of the membership year.</summary>
    public static DateOnly StartsOn(int year) => new(year, AnniversaryMonth, AnniversaryDay + 1);

    /// <summary>The membership year a given date falls in.</summary>
    public static int YearFor(DateOnly date)
    {
        var anniversary = new DateOnly(date.Year, AnniversaryMonth, AnniversaryDay);
        return date > anniversary ? date.Year : date.Year - 1;
    }

    /// <summary>Whether a member with this RenewedThrough date is current on the given day.</summary>
    public static bool IsCurrent(DateOnly? renewedThrough, DateOnly asOf) =>
        renewedThrough.HasValue && asOf <= renewedThrough.Value;

    /// <summary>"2027–28" — how the year is labelled to members.</summary>
    public static string Label(int year) => $"{year}–{(year + 1) % 100:D2}";
}
