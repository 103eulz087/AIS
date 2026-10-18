using FluentValidation;

namespace Akrho.Api.Features.CouncilPermissions;

/// <summary>One requested cell change's own field rules — shared across the batch via
/// RuleForEach(...).SetValidator(...), same composition idiom as
/// ChapterCharterOfficerInputValidator/SaveAttendanceRowRequestValidator.</summary>
public sealed class CouncilPermissionChangeDtoValidator : AbstractValidator<CouncilPermissionChangeDto>
{
    public CouncilPermissionChangeDtoValidator()
    {
        RuleFor(x => x.CouncilOfficeId).GreaterThan(0);
        // PermissionKey is NVARCHAR(60) on dbo.CouncilPermission/dbo.CouncilPermissionChangeRow
        // (db/schema/28_council_permissions.sql) — this is a client-side length hint only; the
        // procedure's own 51932 is the actual check for whether the key is recognised, active
        // and grantable.
        RuleFor(x => x.PermissionKey).NotEmpty().MaximumLength(60);
    }
}

/// <summary>
/// 1-50 changes per batch — the whole batch is rejected together by usp_CouncilPermission_Set
/// on any validation failure, so an empty or unbounded batch is caught here before the round
/// trip. Reason mirrors AckReceipt-style reason fields elsewhere in this codebase (<= 300,
/// matching NVARCHAR(300) on the procedure's own @Reason parameter).
/// </summary>
public sealed class UpdateCouncilPermissionsRequestValidator : AbstractValidator<UpdateCouncilPermissionsRequest>
{
    public UpdateCouncilPermissionsRequestValidator()
    {
        RuleFor(x => x.Changes).NotEmpty()
            .WithMessage("At least one change is required.")
            .Must(c => c.Count <= 50)
            .WithMessage("No more than 50 changes may be submitted at once.")
            .Must(c => c.Select(x => (x.CouncilOfficeId, x.PermissionKey)).Distinct().Count() == c.Count)
            .WithMessage("Each office/permission pair may be given at most once.");
        RuleForEach(x => x.Changes).SetValidator(new CouncilPermissionChangeDtoValidator());

        RuleFor(x => x.Reason).MaximumLength(300);
    }
}
