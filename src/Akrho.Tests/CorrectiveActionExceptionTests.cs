using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the corrective-action (discipline)
/// procedures — same pattern as <see cref="LedgerExceptionTests"/> and MeetingException. See
/// usp_CorrectiveAction_File.sql, usp_CorrectiveAction_AddUpdate.sql,
/// usp_CorrectiveAction_GetByChapter.sql and usp_CorrectiveAction_Get.sql for the THROWs this
/// mirrors (51249-51257).
/// </summary>
public class CorrectiveActionExceptionTests
{
    [Fact]
    public void Only_chapter_admin_may_file_maps_to_Forbidden()
    {
        new CorrectiveActionException(51249, "Only the chapter admin may file a corrective action.")
            .Category.Should().Be(CorrectiveActionErrorCategory.Forbidden);
    }

    [Fact]
    public void Subject_from_another_chapter_maps_to_BadRequest()
    {
        new CorrectiveActionException(51250, "That member does not belong to this chapter.")
            .Category.Should().Be(CorrectiveActionErrorCategory.BadRequest);
    }

    [Fact]
    public void Unrecognised_category_maps_to_BadRequest()
    {
        new CorrectiveActionException(51251, "Unrecognised corrective action category.")
            .Category.Should().Be(CorrectiveActionErrorCategory.BadRequest);
    }

    [Fact]
    public void Bad_status_or_blank_narrative_on_file_maps_to_BadRequest()
    {
        new CorrectiveActionException(51252, "A corrective action must have a narrative.")
            .Category.Should().Be(CorrectiveActionErrorCategory.BadRequest);
    }

    [Fact]
    public void Case_not_found_on_add_update_maps_to_NotFound()
    {
        new CorrectiveActionException(51253, "Corrective action not found.")
            .Category.Should().Be(CorrectiveActionErrorCategory.NotFound);
    }

    [Fact]
    public void Only_chapter_admin_may_update_maps_to_Forbidden()
    {
        new CorrectiveActionException(51254, "Only the chapter admin may update a corrective action.")
            .Category.Should().Be(CorrectiveActionErrorCategory.Forbidden);
    }

    [Fact]
    public void Bad_status_on_update_maps_to_BadRequest()
    {
        new CorrectiveActionException(51255, "Unrecognised status.")
            .Category.Should().Be(CorrectiveActionErrorCategory.BadRequest);
    }

    [Fact]
    public void Not_a_chapter_member_on_list_maps_to_Forbidden()
    {
        new CorrectiveActionException(51256, "Not permitted to read this chapter's corrective actions.")
            .Category.Should().Be(CorrectiveActionErrorCategory.Forbidden);
    }

    [Fact]
    public void Not_found_on_get_maps_to_NotFound_for_both_bad_id_and_wrong_chapter()
    {
        // Same message, same category, for a nonexistent case AND a wrong-chapter caller —
        // deliberate anti-enumeration (usp_CorrectiveAction_Get's own header comment).
        new CorrectiveActionException(51257, "Corrective action not found.")
            .Category.Should().Be(CorrectiveActionErrorCategory.NotFound);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        new CorrectiveActionException(50999, "Some other procedure error.")
            .Category.Should().Be(CorrectiveActionErrorCategory.BadRequest);
    }
}
