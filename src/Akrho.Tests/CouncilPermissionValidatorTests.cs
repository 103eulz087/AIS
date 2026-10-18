using Akrho.Api.Features.CouncilPermissions;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// UpdateCouncilPermissionsRequestValidator / CouncilPermissionChangeDtoValidator — the
/// client-side guard rails ahead of usp_CouncilPermission_Set's own round trip. No
/// FluentValidation.TestHelper package in this project (see Akrho.Tests.csproj), so these
/// call .Validate(...) directly and assert on the plain ValidationResult, same approach this
/// project already uses nowhere else for a FluentValidation validator — this is the first.
/// </summary>
public class UpdateCouncilPermissionsRequestValidatorTests
{
    private readonly UpdateCouncilPermissionsRequestValidator _validator = new();

    private static CouncilPermissionChangeDto Change(int officeId = 1, string key = "ChapterRegistration.Review", bool granted = true)
        => new(officeId, key, granted);

    [Fact]
    public void Empty_change_list_is_invalid()
    {
        var result = _validator.Validate(new UpdateCouncilPermissionsRequest([], null));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Changes" && e.ErrorMessage.Contains("At least one change is required"));
    }

    [Fact]
    public void More_than_50_changes_is_invalid()
    {
        var changes = Enumerable.Range(1, 51).Select(i => Change(i)).ToList();

        var result = _validator.Validate(new UpdateCouncilPermissionsRequest(changes, null));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("No more than 50 changes"));
    }

    [Fact]
    public void Exactly_50_changes_is_valid_shape_wise()
    {
        // 50 is the bar itself — the boundary must be inclusive, not exclusive.
        var changes = Enumerable.Range(1, 50).Select(i => Change(i)).ToList();

        var result = _validator.Validate(new UpdateCouncilPermissionsRequest(changes, null));

        result.Errors.Should().NotContain(e => e.ErrorMessage.Contains("No more than 50 changes"));
    }

    [Fact]
    public void Duplicate_office_permission_pair_is_invalid()
    {
        var changes = new[] { Change(1, "ChapterRegistration.Review", true), Change(1, "ChapterRegistration.Review", false) };

        var result = _validator.Validate(new UpdateCouncilPermissionsRequest(changes, null));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("at most once"));
    }

    [Fact]
    public void Same_office_different_key_is_not_a_duplicate()
    {
        var changes = new[] { Change(1, "ChapterRegistration.Review", true), Change(1, "ChapterRegistration.Verify", true) };

        var result = _validator.Validate(new UpdateCouncilPermissionsRequest(changes, null));

        result.Errors.Should().NotContain(e => e.ErrorMessage.Contains("at most once"));
    }

    [Fact]
    public void Reason_over_300_characters_is_invalid()
    {
        var reason = new string('x', 301);

        var result = _validator.Validate(new UpdateCouncilPermissionsRequest([Change()], reason));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == "Reason");
    }

    [Fact]
    public void Reason_of_exactly_300_characters_is_valid()
    {
        var reason = new string('x', 300);

        var result = _validator.Validate(new UpdateCouncilPermissionsRequest([Change()], reason));

        result.Errors.Should().NotContain(e => e.PropertyName == "Reason");
    }

    [Fact]
    public void Null_reason_is_valid_a_reason_is_optional()
    {
        var result = _validator.Validate(new UpdateCouncilPermissionsRequest([Change()], null));

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void A_single_well_formed_change_with_no_reason_is_valid()
    {
        var result = _validator.Validate(new UpdateCouncilPermissionsRequest([Change(2, "CouncilStatistics.Read", false)], null));

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Each_changes_own_field_rules_are_enforced_through_RuleForEach()
    {
        // CouncilOfficeId <= 0 and an empty PermissionKey are each individually invalid,
        // proven here through the parent validator (RuleForEach(...).SetValidator(...)) rather
        // than only unit-testing CouncilPermissionChangeDtoValidator in isolation, so a future
        // edit that detaches the composition is caught too.
        var badOfficeId = _validator.Validate(new UpdateCouncilPermissionsRequest([Change(0)], null));
        badOfficeId.IsValid.Should().BeFalse();

        var badKey = _validator.Validate(new UpdateCouncilPermissionsRequest([Change(1, "")], null));
        badKey.IsValid.Should().BeFalse();

        var keyTooLong = _validator.Validate(new UpdateCouncilPermissionsRequest([Change(1, new string('k', 61))], null));
        keyTooLong.IsValid.Should().BeFalse();
    }
}

public class CouncilPermissionChangeDtoValidatorTests
{
    private readonly CouncilPermissionChangeDtoValidator _validator = new();

    [Fact]
    public void CouncilOfficeId_must_be_greater_than_zero()
    {
        _validator.Validate(new CouncilPermissionChangeDto(0, "ChapterRegistration.Review", true)).IsValid.Should().BeFalse();
        _validator.Validate(new CouncilPermissionChangeDto(-1, "ChapterRegistration.Review", true)).IsValid.Should().BeFalse();
        _validator.Validate(new CouncilPermissionChangeDto(1, "ChapterRegistration.Review", true)).IsValid.Should().BeTrue();
    }

    [Fact]
    public void PermissionKey_must_be_present_and_at_most_60_characters()
    {
        _validator.Validate(new CouncilPermissionChangeDto(1, "", true)).IsValid.Should().BeFalse();
        _validator.Validate(new CouncilPermissionChangeDto(1, new string('k', 61), true)).IsValid.Should().BeFalse();
        _validator.Validate(new CouncilPermissionChangeDto(1, new string('k', 60), true)).IsValid.Should().BeTrue();
    }
}
