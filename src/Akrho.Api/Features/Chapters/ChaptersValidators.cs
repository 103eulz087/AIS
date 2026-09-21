using FluentValidation;

namespace Akrho.Api.Features.Chapters;

public sealed class SeatChapterOfficerRequestValidator : AbstractValidator<SeatChapterOfficerRequest>
{
    public SeatChapterOfficerRequestValidator()
    {
        RuleFor(x => x.MemberId).GreaterThan(0);
        RuleFor(x => x.OfficeId).GreaterThan(0);
    }
}

public sealed class UnseatChapterOfficerRequestValidator : AbstractValidator<UnseatChapterOfficerRequest>
{
    public UnseatChapterOfficerRequestValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(300)
            .WithMessage("A reason is required.");
    }
}
