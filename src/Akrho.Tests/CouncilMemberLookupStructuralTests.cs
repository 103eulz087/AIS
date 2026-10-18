using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * "From all records" seating lookup (2026-10-18) — structural checks, no database.
 * usp_Council_MemberLookup finds an out-of-jurisdiction nominee by NAME + MOBILE NUMBER
 * together instead of member number. It must stay a lookup, never a browsable list
 * (invariant #7), and must never hand the mobile number back.
 */
public class CouncilMemberLookupStructuralTests
{
    private static string Lookup()
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        var src = File.ReadAllText(Path.Combine(root!, "db", "procs", "usp_Council_Seating.sql"));
        var proc = src[src.IndexOf("CREATE OR ALTER PROCEDURE dbo.usp_Council_MemberLookup", StringComparison.Ordinal)..];
        return proc[..proc.IndexOf("\nGO", StringComparison.Ordinal)];
    }

    [Fact]
    public void Name_alone_is_rejected_both_name_and_mobile_are_required()
    {
        Lookup().Should().Contain("@MemberNumber IS NULL AND (@Name IS NULL OR LEN(@Name) < 2 OR @Mobile10 IS NULL)")
            .And.Contain("THROW 51652");
    }

    [Fact]
    public void Mobile_must_match_and_name_only_narrows()
    {
        var src = Lookup();
        var mobile = src.IndexOf(", 10) = @Mobile10", StringComparison.Ordinal);
        var name = src.IndexOf("m.GiftName  LIKE '%' + @Name + '%'", StringComparison.Ordinal);
        mobile.Should().BeGreaterThan(0);
        name.Should().BeGreaterThan(mobile);
        src[mobile..name].Should().Contain("AND (", "the name check is ANDed onto the mobile match, never ORed");
    }

    [Fact]
    public void Never_returns_the_mobile_number_and_keeps_the_column_list_the_deployed_api_maps()
    {
        var src = Lookup();
        var select = src[src.IndexOf("SELECT  m.MemberId", StringComparison.Ordinal)..src.IndexOf("FROM    dbo.Member m", StringComparison.Ordinal)];
        select.Should().NotContain("m.MobileNo AS").And.NotContain("m.MobileNo,").And.NotContain("FullName");
        select.Should().Contain("m.MemberId, m.GiftName, m.MemberNumber, ch.ChapterName, ms.StatusName");
    }

    [Fact]
    public void Same_seating_authority_gate_as_the_eligible_list()
    {
        Lookup().Should().Contain("EXEC dbo.usp_Council_ResolveSeatingAuthority")
            .And.Contain("r.RoleName = 'CouncilAdmin'").And.Contain("THROW 51651");
    }
}
