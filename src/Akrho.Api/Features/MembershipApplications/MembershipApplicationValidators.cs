using FluentValidation;

namespace Akrho.Api.Features.MembershipApplications;

/// <summary>
/// A plain, forgiving Philippine mobile-number shape: 09XXXXXXXXX or +639XXXXXXXXX. This is a
/// client-side hint only — nothing here computes arrears, credit, or eligibility, and the
/// procedure does not re-validate the format either. It exists purely to catch an obviously
/// mistyped number before the enrolment link (a later step) has nowhere to go.
/// </summary>
internal static class MembershipApplicationPatterns
{
    public const string MobileNo = @"^(09\d{9}|\+639\d{9})$";
}

public sealed class SubmitMembershipApplicationRequestValidator : AbstractValidator<SubmitMembershipApplicationRequest>
{
    public SubmitMembershipApplicationRequestValidator()
    {
        RuleFor(x => x.ChapterId).GreaterThan(0);

        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(80);
        RuleFor(x => x.MiddleName).MaximumLength(80);
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(80);
        RuleFor(x => x.GiftName).NotEmpty().MaximumLength(60);

        // The server's own check (usp_MembershipApplication_Submit: "a real date in the
        // past") is authoritative and is surfaced verbatim on rejection — this is only a
        // client-side hint to avoid an obviously wrong round trip.
        RuleFor(x => x.BirthDate).NotEmpty().LessThan(DateOnly.FromDateTime(DateTime.UtcNow));

        RuleFor(x => x.MobileNo).NotEmpty().Matches(MembershipApplicationPatterns.MobileNo)
            .WithMessage("Enter a mobile number as 09XXXXXXXXX or +639XXXXXXXXX.");

        RuleFor(x => x.Email).EmailAddress().MaximumLength(200)
            .When(x => !string.IsNullOrWhiteSpace(x.Email));

        RuleFor(x => x.DateSurvive).LessThanOrEqualTo(DateOnly.FromDateTime(DateTime.UtcNow))
            .When(x => x.DateSurvive is not null);

        RuleFor(x => x.PresidentDuringSurvive).MaximumLength(200);
        RuleFor(x => x.MasterInitiatorDuringSurvive).MaximumLength(200);

        RuleFor(x => x.SeconderNameGiven).NotEmpty().MaximumLength(160);
        RuleFor(x => x.SeconderMemberNumberGiven).MaximumLength(30);
    }
}

public sealed class MembershipApplicationIdentifyQueryValidator : AbstractValidator<MembershipApplicationIdentifyQuery>
{
    public MembershipApplicationIdentifyQueryValidator()
    {
        RuleFor(x => x.ReferenceNo).NotEmpty().MaximumLength(20);
        RuleFor(x => x.MobileNo).NotEmpty().MaximumLength(30);
    }
}

public sealed class ResubmitMembershipApplicationRequestValidator : AbstractValidator<ResubmitMembershipApplicationRequest>
{
    public ResubmitMembershipApplicationRequestValidator()
    {
        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(80);
        RuleFor(x => x.MiddleName).MaximumLength(80);
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(80);
        RuleFor(x => x.GiftName).NotEmpty().MaximumLength(60);

        RuleFor(x => x.BirthDate).NotEmpty().LessThan(DateOnly.FromDateTime(DateTime.UtcNow));

        RuleFor(x => x.Email).EmailAddress().MaximumLength(200)
            .When(x => !string.IsNullOrWhiteSpace(x.Email));

        RuleFor(x => x.DateSurvive).LessThanOrEqualTo(DateOnly.FromDateTime(DateTime.UtcNow))
            .When(x => x.DateSurvive is not null);

        RuleFor(x => x.PresidentDuringSurvive).MaximumLength(200);
        RuleFor(x => x.MasterInitiatorDuringSurvive).MaximumLength(200);

        RuleFor(x => x.SeconderNameGiven).NotEmpty().MaximumLength(160);
        RuleFor(x => x.SeconderMemberNumberGiven).MaximumLength(30);
    }
}

public sealed class ApproveMembershipApplicationRequestValidator : AbstractValidator<ApproveMembershipApplicationRequest>
{
    public ApproveMembershipApplicationRequestValidator()
    {
        RuleFor(x => x.SeconderMemberId).GreaterThan(0).When(x => x.SeconderMemberId is not null);
    }
}

public sealed class DecideMembershipApplicationRequestValidator : AbstractValidator<DecideMembershipApplicationRequest>
{
    public DecideMembershipApplicationRequestValidator()
    {
        // The procedure's own rule (>= 10 characters, shown to the applicant) — this just
        // catches an empty or too-short submission before the round trip, same convention
        // ReopenMeetingRequestValidator uses for usp_Meeting_Reopen's identical bar.
        RuleFor(x => x.Reason).NotEmpty().MinimumLength(10).MaximumLength(500);
    }
}
