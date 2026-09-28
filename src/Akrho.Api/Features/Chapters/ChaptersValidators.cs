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

/// <summary>Client-side mirror of usp_Chapter_SearchByJurisdiction's own required-search
/// rule — a hint only, the procedure's own rejection is authoritative.</summary>
public sealed class ChapterJurisdictionSearchRequestValidator : AbstractValidator<ChapterJurisdictionSearchRequest>
{
    public ChapterJurisdictionSearchRequestValidator()
    {
        RuleFor(x => x.Search).NotEmpty().MinimumLength(2).MaximumLength(100)
            .WithMessage("Enter at least 2 characters of a chapter name.");
        RuleFor(x => x.Take).InclusiveBetween(1, 200);
        RuleFor(x => x.Skip).GreaterThanOrEqualTo(0);
    }
}

/// <summary>Client-side mirror of usp_Chapter_Hold/_Release's own "a reason is
/// required" rule — a hint only, the procedure's own rejection is authoritative.</summary>
public sealed class ChapterHoldRequestValidator : AbstractValidator<ChapterHoldRequest>
{
    public ChapterHoldRequestValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(300)
            .WithMessage("A reason is required.");
    }
}
