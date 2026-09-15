using FluentValidation;

namespace Akrho.Api.Features.Auth;

public sealed class SignInRequestValidator : AbstractValidator<SignInRequest>
{
    public SignInRequestValidator()
    {
        RuleFor(x => x.MemberNumber).NotEmpty().MaximumLength(30);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(200);
    }
}
