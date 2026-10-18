using FluentValidation;

namespace Akrho.Api.Features.AppSettings;

public sealed class UpdateAppSettingsRequestValidator : AbstractValidator<UpdateAppSettingsRequest>
{
    public UpdateAppSettingsRequestValidator()
    {
        RuleFor(x => x.TrialDays).InclusiveBetween(1, 365)
            .WithMessage("The free trial must be between 1 and 365 days.");
        RuleFor(x => x.OpenFeatureKeys).NotNull();
        RuleFor(x => x.OpenFeatureKeys).Must(k => k is null || k.Length <= 50)
            .WithMessage("Too many features were sent.");
        // Keys are NVARCHAR(40) and are sent to the procedure comma-separated, so a comma
        // inside one would silently become two keys. The procedure's 51953 is the real check
        // for whether a key exists.
        RuleForEach(x => x.OpenFeatureKeys).NotEmpty().MaximumLength(40)
            .Must(k => k is null || !k.Contains(','))
            .WithMessage("A feature key cannot contain a comma.");
    }
}
