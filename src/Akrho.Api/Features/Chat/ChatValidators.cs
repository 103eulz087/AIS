using FluentValidation;

namespace Akrho.Api.Features.Chat;

public sealed class PostMessageRequestValidator : AbstractValidator<PostMessageRequest>
{
    public PostMessageRequestValidator()
    {
        // Emptiness: usp_ChatMessage_Post's own check (51277) is real defense-in-depth — this
        // just catches it before the round trip.
        // Length: this MaximumLength(2000) is the ONLY gate against an oversized body. The
        // proc's own @Body NVARCHAR(2000) parameter silently TRUNCATES a longer value at
        // parameter-binding time, before the proc body (and CK_ChatMessage_BodyLength) ever
        // run — so unlike emptiness, there is no server-side length check behind this one.
        // Do not remove or weaken this rule on the assumption the database also enforces it.
        RuleFor(x => x.Body).NotEmpty().MaximumLength(2000);
    }
}

public sealed class FlagMessageRequestValidator : AbstractValidator<FlagMessageRequest>
{
    public FlagMessageRequestValidator()
    {
        RuleFor(x => x.Reason).MaximumLength(200);
    }
}

public sealed class RemoveMessageRequestValidator : AbstractValidator<RemoveMessageRequest>
{
    public RemoveMessageRequestValidator()
    {
        // usp_ChatMessage_Delete's own "a reason is required" check (51278) is the real gate.
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(200);
    }
}

public sealed class ResolveFlagsRequestValidator : AbstractValidator<ResolveFlagsRequest>
{
    public ResolveFlagsRequestValidator()
    {
        RuleFor(x => x.Note).MaximumLength(200);
    }
}

public sealed class MarkReadRequestValidator : AbstractValidator<MarkReadRequest>
{
    public MarkReadRequestValidator()
    {
        RuleFor(x => x.LastReadMessageId).GreaterThan(0);
    }
}
