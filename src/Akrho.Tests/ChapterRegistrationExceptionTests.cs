using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for ChapterRegistrationException,
/// including the two codes that are NOT raised by any usp_ChapterRegistration_* procedure
/// itself but bubble up through Submit/Resubmit/SubmitTurnover from shared council-routing
/// plumbing: usp_Approval_ResolveApprover (51090, db/procs/usp_Approval_Routing.sql) and
/// usp_Council_ResolveJurisdiction (51300, db/procs/usp_Council_ResolveJurisdiction.sql).
/// See MemberProfileExceptionTests for the pattern this follows.
/// </summary>
public class ChapterRegistrationExceptionTests
{
    [Fact]
    public void No_ancestor_council_with_seated_officers_maps_to_BadRequest_with_a_petitioner_facing_message()
    {
        // usp_Approval_ResolveApprover's own THROW text ("Seed the National Council and seat
        // its officers first.") is written for whoever is standing up council data — it must
        // never reach the anonymous petitioner filling out this form. This layer substitutes
        // it, without ever touching the shared procedure's own message.
        var ex = new ChapterRegistrationException(51090,
            "No ancestor with seated officers. Seed the National Council and seat its officers first.");

        ex.Category.Should().Be(ChapterRegistrationErrorCategory.BadRequest);
        ex.Message.Should().NotContain("Seed the National Council");
        ex.Message.Should().Contain("no council above your area currently has officers in place");
    }

    [Fact]
    public void Missing_national_council_jurisdiction_maps_to_BadRequest_with_the_same_petitioner_facing_message()
    {
        // usp_Council_ResolveJurisdiction's own THROW text references the documentation and a
        // seed-data step number — also developer/operator-facing, also substituted here.
        var ex = new ChapterRegistrationException(51300,
            "No council jurisdiction could be resolved — not even National. Seed the National Council first (docs/AIS-Project-Documentation.md §7A.6, step 0).");

        ex.Category.Should().Be(ChapterRegistrationErrorCategory.BadRequest);
        ex.Message.Should().NotContain("docs/AIS-Project-Documentation.md");
        ex.Message.Should().Contain("no council above your area currently has officers in place");
    }

    [Fact]
    public void An_ordinary_ChapterRegistration_THROW_message_passes_through_unchanged()
    {
        // Everything else on usp_ChapterRegistration_* is already written for the end user —
        // only 51090/51300 get a substituted message.
        var ex = new ChapterRegistrationException(51500, "That proposed chapter name is already taken.");

        ex.Category.Should().Be(ChapterRegistrationErrorCategory.BadRequest);
        ex.Message.Should().Be("That proposed chapter name is already taken.");
    }
}
