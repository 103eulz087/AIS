using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for CouncilPermissionException —
/// db/procs/usp_CouncilPermission_GetGrid.sql (51930) and usp_CouncilPermission_Set.sql
/// (51931-51936). See IdCardExportExceptionTests/CredentialExceptionTests for the pattern
/// this follows.
/// </summary>
public class CouncilPermissionExceptionTests
{
    [Fact]
    public void GetGrid_51930_council_outside_caller_view_maps_to_NotFound()
    {
        // Same anti-enumeration posture as usp_Council_GetRegistry/_GetRoster (51690-51692) —
        // a council id outside the caller's scope must read identically to one that does not
        // exist, so CouncilPermissionsEndpoints.GetGrid turns this into a bare 404.
        new CouncilPermissionException(51930, "That council is outside what you are permitted to view.")
            .Category.Should().Be(CouncilPermissionErrorCategory.NotFound);
    }

    [Fact]
    public void Set_51931_not_this_councils_own_president_maps_to_Forbidden()
    {
        new CouncilPermissionException(51931, "Only this council's own seated President may change its permission grid.")
            .Category.Should().Be(CouncilPermissionErrorCategory.Forbidden);
    }

    [Theory]
    [InlineData(51932, "One or more permissions are not recognised, inactive, or cannot be granted.")]
    [InlineData(51933, "The President's permissions are fixed.")]
    [InlineData(51934, "A read-only office cannot hold a write permission.")]
    [InlineData(51935, "This permission applies to the National Council only.")]
    [InlineData(51936, "Verify, Approve, and Return all require Review — grant Review first.")]
    public void Set_51932_through_51936_all_map_to_BadRequest(int sqlErrorNumber, string message)
    {
        // Every one of these is a batch VALIDATION failure, not an authority failure (that's
        // 51931 alone) and not a visibility failure (that's 51930 alone) — all five collapse to
        // the same BadRequest category.
        new CouncilPermissionException(sqlErrorNumber, message)
            .Category.Should().Be(CouncilPermissionErrorCategory.BadRequest);
    }

    [Fact]
    public void Message_passes_through_unchanged_every_procedures_own_THROW_text_is_already_officer_facing()
    {
        // Unlike ChapterRegistrationException (which substitutes two specific developer-facing
        // messages), no CouncilPermissionException message is ever rewritten — every THROW in
        // usp_CouncilPermission_GetGrid/_Set was authored to be shown as-is.
        var ex = new CouncilPermissionException(51934, "A read-only office cannot hold a write permission.");
        ex.Message.Should().Be("A read-only office cannot hold a write permission.");
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        // Unreachable today — CouncilPermissionRepository's own catch clause only ever lets
        // 51930-51936 through (CouncilPermissionErrors.IsKnown, internal to
        // Akrho.Infrastructure); any other SqlException propagates unwrapped rather than being
        // constructed as this type at all. Pinned anyway, same defence-in-depth posture as
        // IdCardExportExceptionTests' equivalent case: a future THROW number added to either
        // procedure without updating this switch must fail safe, never crash the mapping or
        // silently masquerade as Forbidden/NotFound.
        new CouncilPermissionException(50999, "Some other procedure error.")
            .Category.Should().Be(CouncilPermissionErrorCategory.BadRequest);
    }
}
