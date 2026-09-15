using FluentValidation;

namespace Akrho.Api.Features.Communications;

public sealed class CreateAnnouncementRequestValidator : AbstractValidator<CreateAnnouncementRequest>
{
    public CreateAnnouncementRequestValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(250);
        RuleFor(x => x.Body).NotEmpty();
    }
}

public sealed class EditAnnouncementRequestValidator : AbstractValidator<EditAnnouncementRequest>
{
    public EditAnnouncementRequestValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(250);
        RuleFor(x => x.Body).NotEmpty();
    }
}

public sealed class WithdrawAnnouncementRequestValidator : AbstractValidator<WithdrawAnnouncementRequest>
{
    public WithdrawAnnouncementRequestValidator()
    {
        // The 10-character minimum is usp_Announcement_Withdraw's own rule (error 51173) —
        // the reason is shown to the whole chapter, so it is enforced where the write
        // happens. This just catches an empty submission before the round trip; let the
        // procedure's own message surface for anything shorter.
        RuleFor(x => x.Reason).NotEmpty();
    }
}

public sealed class PublishMemoRequestValidator : AbstractValidator<PublishMemoRequest>
{
    public PublishMemoRequestValidator()
    {
        RuleFor(x => x.Subject).NotEmpty().MaximumLength(250);
        RuleFor(x => x.Body).NotEmpty();
    }
}
