using FluentValidation;

namespace Akrho.Api.Features.Donations;

public sealed class CreateDonationRequestValidator : AbstractValidator<CreateDonationRequest>
{
    public CreateDonationRequestValidator()
    {
        RuleFor(x => x.DonorName).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Amount).GreaterThanOrEqualTo(0m).When(x => x.Amount.HasValue);
        RuleFor(x => x.InKindDescription).MaximumLength(400);
        RuleFor(x => x.ChapterReceiptNo).MaximumLength(60);

        // The procedure's own rule (docs §4.6 / CK_Donation_CashOrKind): a donation must be
        // cash, goods, or both, never neither. Caught here before the round trip.
        RuleFor(x => x)
            .Must(x => x.Amount is > 0 || !string.IsNullOrWhiteSpace(x.InKindDescription))
            .WithMessage("Record a cash amount, an in-kind description, or both.");
    }
}

public sealed class VoidDonationRequestValidator : AbstractValidator<VoidDonationRequest>
{
    public VoidDonationRequestValidator()
    {
        // The 10-character minimum is the procedure's own rule — this just catches an
        // empty submission before the round trip.
        RuleFor(x => x.Reason).NotEmpty();
    }
}
