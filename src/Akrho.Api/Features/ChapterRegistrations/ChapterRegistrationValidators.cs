using FluentValidation;

namespace Akrho.Api.Features.ChapterRegistrations;

/// <summary>
/// A plain, forgiving Philippine mobile-number shape — a client-side hint only, mirroring
/// MembershipApplicationPatterns.MobileNo exactly (kept as its own copy rather than a shared
/// reference, since that one is internal to the MembershipApplications feature folder). The
/// procedure does not re-validate the format either.
/// </summary>
internal static class ChapterRegistrationPatterns
{
    public const string MobileNo = @"^(09\d{9}|\+639\d{9})$";

    /// <summary>
    /// The eight chapter offices are a controlled, server-seeded list (dbo.ChapterOffice).
    /// MaxOfficers bounds a Charter submission's officer count from above ONLY — a hint,
    /// same posture as every other client-side mirror in this class. Deliberately NOT
    /// mirroring "exactly one President must be included" here: that requires resolving
    /// which OfficeId means President, which is server-seeded data this validator has no
    /// business hardcoding (the whole reason the old "== 8" rule never hardcoded a
    /// number either). usp_ChapterRegistration_Submit/_Resubmit resolve President by
    /// NAME and remain the sole, authoritative check — their rejection is surfaced
    /// verbatim to the caller either way.
    /// </summary>
    public const int MaxOfficers = 8;
}

/// <summary>One typed-in Charter officer's own field rules — shared by Submit and Resubmit via
/// RuleForEach(...).SetValidator(...), same composition idiom as
/// SaveAttendanceRequestValidator/SaveAttendanceRowRequestValidator.</summary>
public sealed class ChapterCharterOfficerInputValidator : AbstractValidator<ChapterCharterOfficerInputDto>
{
    public ChapterCharterOfficerInputValidator()
    {
        RuleFor(o => o.OfficeId).GreaterThan(0);
        RuleFor(o => o.FirstName).NotEmpty().MaximumLength(80);
        RuleFor(o => o.MiddleName).MaximumLength(80);
        RuleFor(o => o.LastName).NotEmpty().MaximumLength(80);
        RuleFor(o => o.GiftName).NotEmpty().MaximumLength(60);
        RuleFor(o => o.BirthDate).NotEmpty().LessThan(DateOnly.FromDateTime(DateTime.UtcNow));
        RuleFor(o => o.MobileNo).NotEmpty().Matches(ChapterRegistrationPatterns.MobileNo)
            .WithMessage("Enter a mobile number as 09XXXXXXXXX or +639XXXXXXXXX.");
        RuleFor(o => o.Email).EmailAddress().MaximumLength(200)
            .When(o => !string.IsNullOrWhiteSpace(o.Email));
        RuleFor(o => o.DateSurvive).LessThanOrEqualTo(DateOnly.FromDateTime(DateTime.UtcNow))
            .When(o => o.DateSurvive is not null);
        RuleFor(o => o.PresidentDuringSurvive).MaximumLength(120);
        RuleFor(o => o.MasterInitiatorDuringSurvive).MaximumLength(120);
    }
}

public sealed class SubmitChapterRegistrationRequestValidator : AbstractValidator<SubmitChapterRegistrationRequest>
{
    public SubmitChapterRegistrationRequestValidator()
    {
        RuleFor(x => x.ProposedChapterName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Barangay).MaximumLength(100);
        RuleFor(x => x.RegionId).GreaterThan(0);
        RuleFor(x => x.ProvinceId).GreaterThan(0);
        RuleFor(x => x.MunicipalityId).GreaterThan(0);
        RuleFor(x => x.MarkAccentId).GreaterThan(0).When(x => x.MarkAccentId is not null);

        RuleFor(x => x.Officers).NotEmpty()
            .WithMessage("At least the President must be given.")
            .Must(o => o.Count <= ChapterRegistrationPatterns.MaxOfficers)
            .WithMessage("There are only eight chapter offices — remove a duplicate before submitting.")
            .Must(o => o.Select(x => x.OfficeId).Distinct().Count() == o.Count)
            .WithMessage("Each office may be given at most once.");
        RuleForEach(x => x.Officers).SetValidator(new ChapterCharterOfficerInputValidator());
    }
}

public sealed class ChapterRegistrationIdentifyQueryValidator : AbstractValidator<ChapterRegistrationIdentifyQuery>
{
    public ChapterRegistrationIdentifyQueryValidator()
    {
        RuleFor(x => x.ReferenceNo).NotEmpty().MaximumLength(20);
        RuleFor(x => x.MobileNo).NotEmpty().MaximumLength(30);
    }
}

public sealed class ResubmitChapterRegistrationRequestValidator : AbstractValidator<ResubmitChapterRegistrationRequest>
{
    public ResubmitChapterRegistrationRequestValidator()
    {
        RuleFor(x => x.ProposedChapterName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Barangay).MaximumLength(100);
        RuleFor(x => x.RegionId).GreaterThan(0);
        RuleFor(x => x.ProvinceId).GreaterThan(0);
        RuleFor(x => x.MunicipalityId).GreaterThan(0);
        RuleFor(x => x.MarkAccentId).GreaterThan(0).When(x => x.MarkAccentId is not null);

        RuleFor(x => x.Officers).NotEmpty()
            .WithMessage("At least the President must be given.")
            .Must(o => o.Count <= ChapterRegistrationPatterns.MaxOfficers)
            .WithMessage("There are only eight chapter offices — remove a duplicate before submitting.")
            .Must(o => o.Select(x => x.OfficeId).Distinct().Count() == o.Count)
            .WithMessage("Each office may be given at most once.");
        RuleForEach(x => x.Officers).SetValidator(new ChapterCharterOfficerInputValidator());
    }
}

public sealed class ChapterTurnoverOfficerInputValidator : AbstractValidator<ChapterTurnoverOfficerInputDto>
{
    public ChapterTurnoverOfficerInputValidator()
    {
        RuleFor(o => o.OfficeId).GreaterThan(0);
        RuleFor(o => o.MemberId).GreaterThan(0);
    }
}

public sealed class SubmitChapterTurnoverRequestValidator : AbstractValidator<SubmitChapterTurnoverRequest>
{
    public SubmitChapterTurnoverRequestValidator()
    {
        // Turnover — unchanged by the Charter relaxation above (out of scope for this
        // change; still every one of the eight offices, matching an existing chapter's
        // full annual roster filing).
        RuleFor(x => x.Officers).NotEmpty()
            .Must(o => o.Count == ChapterRegistrationPatterns.MaxOfficers)
            .WithMessage("Exactly one officer must be given for each of the eight chapter offices.");
        RuleForEach(x => x.Officers).SetValidator(new ChapterTurnoverOfficerInputValidator());
    }
}

public sealed class ChapterRegistrationQueueRequestValidator : AbstractValidator<ChapterRegistrationQueueRequest>
{
    public ChapterRegistrationQueueRequestValidator()
    {
        RuleFor(x => x.StatusId).GreaterThan(0).When(x => x.StatusId is not null);
        RuleFor(x => x.Skip).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Take).InclusiveBetween(0, 500);
    }
}

public sealed class VerifyChapterRegistrationOfficerRequestValidator : AbstractValidator<VerifyChapterRegistrationOfficerRequest>
{
    public VerifyChapterRegistrationOfficerRequestValidator()
    {
        RuleFor(x => x.Note).MaximumLength(300);
    }
}

public sealed class ReturnChapterRegistrationRequestValidator : AbstractValidator<ReturnChapterRegistrationRequest>
{
    public ReturnChapterRegistrationRequestValidator()
    {
        // The procedure's own rule (>= 10 characters, shown to the chapter) — this just catches
        // an empty or too-short submission before the round trip, same convention
        // DecideMembershipApplicationRequestValidator uses for usp_MembershipApplication_Return's
        // identical bar.
        RuleFor(x => x.Reason).NotEmpty().MinimumLength(10).MaximumLength(500);
    }
}
