using FluentValidation;

namespace Akrho.Api.Features.Discipline;

/// <summary>
/// The four status values usp_CorrectiveAction_File/usp_CorrectiveAction_AddUpdate accept.
/// A client-side hint only — the procedure's own CHECK is authoritative and its message is
/// surfaced verbatim on rejection (same convention as MembershipApplicationValidators).
/// </summary>
internal static class CorrectiveActionStatuses
{
    public static readonly string[] Allowed = ["Pending", "Under Review", "Reconciled", "Dismissed"];
}

public sealed class FileCorrectiveActionRequestValidator : AbstractValidator<FileCorrectiveActionRequest>
{
    public FileCorrectiveActionRequestValidator()
    {
        RuleFor(x => x.SubjectMemberId).GreaterThan(0);
        RuleFor(x => x.CategoryId).GreaterThan(0);

        // The procedure itself rejects a blank narrative (51252) — this just catches an
        // empty submission before the round trip, and asks for a REAL account rather than
        // a placeholder character.
        RuleFor(x => x.Content).NotEmpty().MinimumLength(10)
            .WithMessage("Enter the account of what happened. A placeholder is not enough.");

        RuleFor(x => x.DateFiled).NotEmpty()
            .LessThanOrEqualTo(DateOnly.FromDateTime(DateTime.UtcNow))
            .WithMessage("The filing date cannot be in the future.");

        RuleFor(x => x.InitialStatusName).Must(s => CorrectiveActionStatuses.Allowed.Contains(s))
            .When(x => !string.IsNullOrWhiteSpace(x.InitialStatusName))
            .WithMessage("Use Pending, Under Review, Reconciled or Dismissed.");
    }
}

public sealed class AddCorrectiveActionUpdateRequestValidator : AbstractValidator<AddCorrectiveActionUpdateRequest>
{
    public AddCorrectiveActionUpdateRequestValidator()
    {
        RuleFor(x => x.NewStatusName).NotEmpty()
            .Must(s => CorrectiveActionStatuses.Allowed.Contains(s))
            .WithMessage("Use Pending, Under Review, Reconciled or Dismissed.");
    }
}

// No validator for CorrectiveActionListRequest — same as MeetingListRequest/MeetingsEndpoints.List:
// paging is clamped in the repository (Math.Clamp(take, 1, 500)), and the endpoint applies the
// same "Take == 0 means unset, use 50" fallback [AsParameters] binding requires (a record's
// default parameter value does not apply when the query string omits the field).
