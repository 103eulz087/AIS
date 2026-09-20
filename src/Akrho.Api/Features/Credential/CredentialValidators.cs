using FluentValidation;

namespace Akrho.Api.Features.Credential;

public sealed class ScanRequestValidator : AbstractValidator<ScanRequest>
{
    public ScanRequestValidator()
    {
        // A default/empty Guid must fail here rather than silently becoming a lookup for
        // 00000000-0000-0000-0000-000000000000 downstream — same rule as VerifyTokenRequestValidator.
        RuleFor(x => x.Token).NotEmpty();
        RuleFor(x => x.DeviceHint).MaximumLength(120);
    }
}
