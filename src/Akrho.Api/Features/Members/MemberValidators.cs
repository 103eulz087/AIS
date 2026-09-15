using System.Text.RegularExpressions;
using FluentValidation;

namespace Akrho.Api.Features.Members;

public sealed class MemberSearchRequestValidator : AbstractValidator<MemberSearchRequest>
{
    public MemberSearchRequestValidator()
    {
        RuleFor(x => x.Take).InclusiveBetween(1, 200);
        RuleFor(x => x.Skip).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Search).MaximumLength(100);
        RuleFor(x => x.StatusId).GreaterThan(0).When(x => x.StatusId.HasValue);
    }
}

/// <summary>
/// Validates the shape of the request only (format, length, non-blank). Whether
/// CurrentPassword is actually REQUIRED for this particular call depends on whether MobileNo
/// is really changing from what is on file — that comparison needs a database read, so it
/// happens in the endpoint handler, not here (FluentValidation validates a DTO in isolation;
/// it has no access to the caller's current row).
/// </summary>
public sealed class UpdateMemberProfileRequestValidator : AbstractValidator<UpdateMemberProfileRequest>
{
    // Loose on purpose — this is a member self-edit form filled in on a phone, not a
    // government ID form. Digits, spaces, +, and - cover local and +63 formats without
    // rejecting a legitimate number over some arbitrary pattern.
    private static readonly Regex MobilePattern = new(@"^[0-9+\-\s]{7,20}$", RegexOptions.Compiled);

    public UpdateMemberProfileRequestValidator()
    {
        RuleFor(x => x.MobileNo)
            .NotEmpty().WithMessage("A mobile number is required. It cannot be blanked once set.");

        RuleFor(x => x.MobileNo)
            .Matches(MobilePattern).WithMessage("Enter a valid mobile number.")
            .When(x => !string.IsNullOrWhiteSpace(x.MobileNo));

        RuleFor(x => x.Email)
            .EmailAddress().WithMessage("Enter a valid email address.")
            .When(x => !string.IsNullOrWhiteSpace(x.Email));

        RuleFor(x => x.Address).MaximumLength(250);
        RuleFor(x => x.Profession).MaximumLength(100);
        RuleFor(x => x.SkillIds).NotNull();
        RuleFor(x => x.RowVersion).NotNull().Must(v => v.Length == 8)
            .WithMessage("Refresh and try again.");
    }
}

public sealed class ClaimMemberPhotoRequestValidator : AbstractValidator<ClaimMemberPhotoRequest>
{
    public ClaimMemberPhotoRequestValidator()
    {
        RuleFor(x => x.AttachmentStagingId).GreaterThan(0);
    }
}
