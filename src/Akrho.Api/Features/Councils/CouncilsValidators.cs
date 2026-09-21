using FluentValidation;

namespace Akrho.Api.Features.Councils;

/// <summary>Client-side mirror of usp_Council_Create's own "exactly one of Region/
/// Province/Municipality" rule — a hint only; the procedure's own rejection is
/// authoritative.</summary>
public sealed class CreateCouncilRequestValidator : AbstractValidator<CreateCouncilRequest>
{
    public CreateCouncilRequestValidator()
    {
        RuleFor(x => x.ParentCouncilId).GreaterThan(0);
        RuleFor(x => x.CouncilName).NotEmpty().MaximumLength(150);
        RuleFor(x => x)
            .Must(x => (x.RegionId is not null ? 1 : 0) + (x.ProvinceId is not null ? 1 : 0)
                     + (x.MunicipalityId is not null ? 1 : 0) == 1)
            .WithMessage("Give exactly one of RegionId, ProvinceId or MunicipalityId.");
    }
}

public sealed class SeatCouncilOfficerRequestValidator : AbstractValidator<SeatCouncilOfficerRequest>
{
    public SeatCouncilOfficerRequestValidator()
    {
        RuleFor(x => x.MemberId).GreaterThan(0);
        RuleFor(x => x.CouncilOfficeId).GreaterThan(0);
        RuleFor(x => x.OutsideJurisdictionReason).MaximumLength(300);
    }
}

public sealed class UnseatCouncilOfficerRequestValidator : AbstractValidator<UnseatCouncilOfficerRequest>
{
    public UnseatCouncilOfficerRequestValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(300)
            .WithMessage("A reason is required.");
    }
}
