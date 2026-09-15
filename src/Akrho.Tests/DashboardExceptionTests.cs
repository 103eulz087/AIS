using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the Chapter Dashboard.
/// See usp_Dashboard_GetChapterSummary.sql (51258) for the THROW this mirrors, and
/// LedgerException/MeetingException for the pattern this follows.
/// </summary>
public class DashboardExceptionTests
{
    [Fact]
    public void Not_permitted_to_read_chapter_dashboard_maps_to_Forbidden()
    {
        new DashboardException(51258, "Not permitted to read this chapter's dashboard.")
            .Category.Should().Be(DashboardErrorCategory.Forbidden);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        new DashboardException(50999, "Some other procedure error.")
            .Category.Should().Be(DashboardErrorCategory.BadRequest);
    }
}
