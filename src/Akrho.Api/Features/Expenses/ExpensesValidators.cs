using FluentValidation;

namespace Akrho.Api.Features.Expenses;

public sealed class CreateExpenseRequestValidator : AbstractValidator<CreateExpenseRequest>
{
    public CreateExpenseRequestValidator()
    {
        RuleFor(x => x.Payee).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Amount).GreaterThan(0m);
        RuleFor(x => x.ExpenseDate).NotEmpty();
        RuleFor(x => x.Description).MaximumLength(4000);

        // The procedure's own rule (docs §4.6: at least one receipt is required) — this just
        // catches an empty submission before the round trip.
        RuleFor(x => x.AttachmentStagingIds)
            .NotNull()
            .Must(ids => ids.Count > 0)
            .WithMessage("At least one receipt attachment is required to record an expense.");
    }
}

public sealed class VoidExpenseRequestValidator : AbstractValidator<VoidExpenseRequest>
{
    public VoidExpenseRequestValidator()
    {
        // The 10-character minimum is the procedure's own rule (it is shown to the whole
        // chapter, so it is enforced where the write happens). This just catches an empty
        // submission before the round trip.
        RuleFor(x => x.Reason).NotEmpty();
    }
}
