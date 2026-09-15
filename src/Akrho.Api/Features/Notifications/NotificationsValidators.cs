using FluentValidation;

namespace Akrho.Api.Features.Notifications;

public sealed class RegisterPushSubscriptionRequestValidator : AbstractValidator<RegisterPushSubscriptionRequest>
{
    public RegisterPushSubscriptionRequestValidator()
    {
        // Column-length gates matching usp_PushSubscription_Register's own parameter sizes
        // (@Endpoint NVARCHAR(500), @P256dh NVARCHAR(200), @AuthSecret NVARCHAR(100),
        // @DeviceHint NVARCHAR(120)) — same "catch it before the round trip, the column would
        // otherwise just truncate" reasoning as Features/Chat's PostMessageRequestValidator.
        RuleFor(x => x.Endpoint).NotEmpty().MaximumLength(500);
        RuleFor(x => x.P256dh).NotEmpty().MaximumLength(200);
        RuleFor(x => x.AuthSecret).NotEmpty().MaximumLength(100);
        RuleFor(x => x.DeviceHint).MaximumLength(120);
    }
}
