using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping that closes the P1 defect: a plain
/// member attempting a ledger reversal must get a clean 403 (the procedure's own message),
/// never a raw 500. See usp_Ledger_Reverse.sql (51167) and usp_Ledger_GetByChapter.sql
/// (51020) for the THROWs this mirrors, and MeetingException for the pattern this follows.
/// </summary>
public class LedgerExceptionTests
{
    [Fact]
    public void Entry_not_found_maps_to_NotFound()
    {
        new LedgerException(51021, "Ledger entry not found.")
            .Category.Should().Be(LedgerErrorCategory.NotFound);
    }

    [Fact]
    public void Already_reversed_maps_to_Conflict()
    {
        new LedgerException(51022, "That entry has already been reversed.")
            .Category.Should().Be(LedgerErrorCategory.Conflict);
    }

    [Fact]
    public void Not_permitted_to_reverse_maps_to_Forbidden()
    {
        // This is the exact case the P1 fix targets: a member with no Treasurer/Admin
        // role in the entry's chapter must reach the caller as a 403, with this message,
        // not an unhandled SqlException that becomes a generic 500.
        new LedgerException(51167, "Not permitted to reverse this chapter's ledger entries.")
            .Category.Should().Be(LedgerErrorCategory.Forbidden);
    }

    [Fact]
    public void Not_permitted_to_read_chapter_ledger_maps_to_Forbidden()
    {
        new LedgerException(51020, "Not permitted to read this chapter's ledger.")
            .Category.Should().Be(LedgerErrorCategory.Forbidden);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        new LedgerException(50999, "Some other procedure error.")
            .Category.Should().Be(LedgerErrorCategory.BadRequest);
    }
}
