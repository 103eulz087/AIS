using FluentValidation;

namespace Akrho.Api.Features.Members;

public sealed class MemberSearchRequestValidator : AbstractValidator<MemberSearchRequest>
{
    public MemberSearchRequestValidator()
    {
        RuleFor(x => x.Take).InclusiveBetween(1, 200);
        RuleFor(x => x.Skip).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Search).MaximumLength(100);
    }
}
