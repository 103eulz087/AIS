using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the self-service profile module.
/// See usp_Member_GetOwnProfile.sql, usp_Member_UpdateOwnProfile.sql, usp_Member_SetPhoto.sql
/// and usp_Member_GetPhoto.sql for the THROWs this mirrors, and LedgerException/MeetingException
/// for the pattern this follows.
/// </summary>
public class MemberProfileExceptionTests
{
    [Fact]
    public void Member_not_found_on_get_own_profile_maps_to_NotFound()
    {
        new MemberProfileException(51240, "Member not found.")
            .Category.Should().Be(MemberProfileErrorCategory.NotFound);
    }

    [Fact]
    public void Blank_mobile_number_maps_to_BadRequest()
    {
        new MemberProfileException(51241,
                "A mobile number is required. It cannot be blanked once set — it is how your account is reached and recovered.")
            .Category.Should().Be(MemberProfileErrorCategory.BadRequest);
    }

    [Fact]
    public void Member_not_found_on_update_maps_to_NotFound()
    {
        new MemberProfileException(51242, "Member not found.")
            .Category.Should().Be(MemberProfileErrorCategory.NotFound);
    }

    [Fact]
    public void Unrecognised_blood_type_maps_to_BadRequest()
    {
        new MemberProfileException(51243, "That blood type is not on file. Choose one from the list.")
            .Category.Should().Be(MemberProfileErrorCategory.BadRequest);
    }

    [Fact]
    public void Inactive_or_unknown_skill_maps_to_BadRequest()
    {
        new MemberProfileException(51244, "One or more selected skills are not on the current list. Refresh and try again.")
            .Category.Should().Be(MemberProfileErrorCategory.BadRequest);
    }

    [Fact]
    public void Stale_row_version_maps_to_Conflict()
    {
        // This is the one that must NEVER become a raw concurrency exception or a 400 —
        // the resource's own state moved under the caller, nothing about the request was
        // invalid.
        new MemberProfileException(51245, "This profile changed since you loaded it. Refresh and try again.")
            .Category.Should().Be(MemberProfileErrorCategory.Conflict);
    }

    [Fact]
    public void Bad_staged_photo_claim_maps_to_BadRequest()
    {
        new MemberProfileException(51246, "That upload was not found, or has already been used.")
            .Category.Should().Be(MemberProfileErrorCategory.BadRequest);
    }

    [Fact]
    public void Photo_not_found_maps_to_NotFound()
    {
        // usp_Member_GetPhoto throws this identically for a nonexistent member, a
        // wrong-chapter caller, and a member who has never set a photo — anti-enumeration.
        new MemberProfileException(51247, "Photo not found.")
            .Category.Should().Be(MemberProfileErrorCategory.NotFound);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        new MemberProfileException(50999, "Some other procedure error.")
            .Category.Should().Be(MemberProfileErrorCategory.BadRequest);
    }
}
