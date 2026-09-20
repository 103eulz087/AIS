using FluentValidation;

namespace Akrho.Api.Features.Auth;

public sealed class SignInRequestValidator : AbstractValidator<SignInRequest>
{
    public SignInRequestValidator()
    {
        RuleFor(x => x.Identifier).NotEmpty().MaximumLength(30);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
    }
}

public sealed class ChangePasswordRequestValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().MaximumLength(200);
        // 10 chars, matching Enrol.tsx's own first-time-set hint — one rule for both paths.
        RuleFor(x => x.NewPassword).NotEmpty().MinimumLength(10).MaximumLength(200);
    }
}
