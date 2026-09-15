using FluentValidation;

namespace Akrho.Api.Features.Enrolment;

public sealed class EnrolmentCompleteRequestValidator : AbstractValidator<EnrolmentCompleteRequest>
{
    // Deliberately short and hardcoded — this slice does not reach for an external
    // breached-password API. It exists to catch the obviously bad choices, not to
    // grade password strength.
    private static readonly HashSet<string> CommonPasswords = new(StringComparer.OrdinalIgnoreCase)
    {
        "password", "password123", "12345678", "123456789", "1234567890",
        "qwertyuiop", "letmein1", "11111111", "00000000", "iloveyou1", "admin1234",
    };

    public EnrolmentCompleteRequestValidator()
    {
        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(10).WithMessage("Password needs to be at least 10 characters.")
            .MaximumLength(200)
            .Must(p => !CommonPasswords.Contains(p))
            .WithMessage("That password is too easy to guess. Please choose another.");
    }
}
