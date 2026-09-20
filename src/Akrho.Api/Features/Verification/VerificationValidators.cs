using FluentValidation;

namespace Akrho.Api.Features.Verification;

public sealed class VerifyTokenRequestValidator : AbstractValidator<VerifyTokenRequest>
{
    public VerifyTokenRequestValidator()
    {
        // A default/empty Guid must fail here rather than silently becoming a lookup for
        // 00000000-0000-0000-0000-000000000000 downstream.
        RuleFor(x => x.Token).NotEmpty();
        RuleFor(x => x.DeviceHint).MaximumLength(120);
    }
}
