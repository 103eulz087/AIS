using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the National ID card export module.
/// See usp_Member_ListForIdCardExport.sql / usp_Credential_BulkIssueForExport.sql (51580/51581)
/// for the THROWs this mirrors, and CredentialExceptionTests for the pattern this follows.
/// </summary>
public class IdCardExportExceptionTests
{
    [Fact]
    public void Wrong_seat_maps_to_Forbidden()
    {
        // 51581 — caller holds CouncilAdmin somewhere, but not on the National Council
        // specifically. IdCardExportEndpoints.Export maps this category to HTTP 403.
        new IdCardExportException(51581, "Only the National Council Admin may run an ID card export.")
            .Category.Should().Be(IdCardExportErrorCategory.Forbidden);
    }

    [Fact]
    public void Missing_National_council_configuration_maps_to_Conflict()
    {
        // 51580 — the National Council row itself is missing/misconfigured. Not the caller's
        // fault and not fixable by retrying, so this is Conflict (409) rather than Forbidden.
        new IdCardExportException(51580, "The National Council is not configured. Seed it before running an ID card export.")
            .Category.Should().Be(IdCardExportErrorCategory.Conflict);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_Conflict_not_a_silent_pass()
    {
        // Unreachable today — IdCardExportRepository's own catch clause only ever lets
        // 51580/51581 through (IdCardExportErrors.IsKnown, internal to Akrho.Infrastructure);
        // any other SqlException propagates unwrapped rather than being constructed as this
        // type at all. Pinned anyway, same defence-in-depth posture as
        // CredentialExceptionTests' equivalent case: if a THROW number is ever added to the
        // procedures without updating this switch, it must fail safe (Conflict), never crash
        // the mapping or silently masquerade as Forbidden.
        new IdCardExportException(50999, "Some other procedure error.")
            .Category.Should().Be(IdCardExportErrorCategory.Conflict);
    }
}
