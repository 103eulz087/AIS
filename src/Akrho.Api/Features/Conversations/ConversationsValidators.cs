using FluentValidation;

namespace Akrho.Api.Features.Conversations;

public sealed class StartConversationRequestValidator : AbstractValidator<StartConversationRequest>
{
    public StartConversationRequestValidator()
    {
        // usp_ChatRoom_EnsurePrivate's own self-conversation check (51281) and its merged
        // "not permitted" check (51280) are the real gates — this just catches an obviously
        // malformed id before the round trip.
        RuleFor(x => x.WithMemberId).GreaterThan(0);
    }
}

public sealed class PostPrivateMessageRequestValidator : AbstractValidator<PostPrivateMessageRequest>
{
    public PostPrivateMessageRequestValidator()
    {
        // Same reasoning as Features/Chat's PostMessageRequestValidator: usp_ChatMessage_PostPrivate's
        // own @Body NVARCHAR(2000) parameter silently TRUNCATES a longer value at
        // parameter-binding time, so this MaximumLength is the only real gate against an
        // oversized body — do not remove or weaken it on the assumption the database enforces it.
        RuleFor(x => x.Body).NotEmpty().MaximumLength(2000);
    }
}

public sealed class MarkPrivateReadRequestValidator : AbstractValidator<MarkPrivateReadRequest>
{
    public MarkPrivateReadRequestValidator()
    {
        RuleFor(x => x.LastReadMessageId).GreaterThan(0);
    }
}
