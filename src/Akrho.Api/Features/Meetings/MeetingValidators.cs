using FluentValidation;

namespace Akrho.Api.Features.Meetings;

public sealed class CreateMeetingRequestValidator : AbstractValidator<CreateMeetingRequest>
{
    public CreateMeetingRequestValidator()
    {
        RuleFor(x => x.Subject).NotEmpty().MaximumLength(250);
        RuleFor(x => x.MeetingDate).NotEmpty();
        RuleFor(x => x.Location).MaximumLength(250);
    }
}

public sealed class UpdateMeetingRequestValidator : AbstractValidator<UpdateMeetingRequest>
{
    public UpdateMeetingRequestValidator()
    {
        RuleFor(x => x.Subject).NotEmpty().MaximumLength(250);
        RuleFor(x => x.MeetingDate).NotEmpty();
        RuleFor(x => x.Location).MaximumLength(250);
    }
}

public sealed class SaveAttendanceRowRequestValidator : AbstractValidator<SaveAttendanceRowRequest>
{
    public SaveAttendanceRowRequestValidator()
    {
        RuleFor(x => x.MemberId).GreaterThan(0);
        RuleFor(x => x.AttendanceStatusId).GreaterThan(0);

        // Contributions are voluntary (CLAUDE.md invariant #5). The ENTIRE rule is
        // non-negative — no upper bound, no comparison to any "expected" amount.
        RuleFor(x => x.FundAmount).GreaterThanOrEqualTo(0m);
    }
}

public sealed class SaveAttendanceRequestValidator : AbstractValidator<SaveAttendanceRequest>
{
    public SaveAttendanceRequestValidator()
    {
        RuleFor(x => x.Rows).NotNull();
        RuleForEach(x => x.Rows).SetValidator(new SaveAttendanceRowRequestValidator());
    }
}

public sealed class ReopenMeetingRequestValidator : AbstractValidator<ReopenMeetingRequest>
{
    public ReopenMeetingRequestValidator()
    {
        // The 10-character minimum is the procedure's own rule (it is shown to the whole
        // chapter, so it is enforced where the write happens). This just catches an empty
        // submission before the round trip.
        RuleFor(x => x.Reason).NotEmpty();
    }
}
