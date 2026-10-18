using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.AppSettings;

/// <summary>
/// The free trial for members who have not paid this membership year
/// (db/schema/30_app_settings_free_trial.sql). Two parts: the caller's own access state
/// (any signed-in member) and National's settings screen (AppSettings.Manage on a National
/// seat, enforced by the procedures). Never gated by RequireFeature — a locked member must
/// always be able to ask what he may still use.
/// </summary>
public static class AppSettingsEndpoints
{
    public static IEndpointRouteBuilder MapAppSettings(this IEndpointRouteBuilder app)
    {
        // Own route rather than inside Features/Members: /api/members/me/* there is a mixed
        // group, and this one must stay ungated.
        app.MapGet("/api/members/me/access", GetMyAccess).WithTags("AppSettings")
            .WithName("GetMyAccess").RequireAuthorization();

        var g = app.MapGroup("/api/app-settings").WithTags("AppSettings")
            .RequireAuthorization(AuthorizationPolicies.AppSettingsManage);
        g.MapGet("", GetSettings).WithName("GetAppSettings");
        g.MapPut("", UpdateSettings).WithName("UpdateAppSettings");

        return app;
    }

    // Own data only: the member id comes from the JWT, never from the request.
    private static async Task<Ok<MemberAccessDto>> GetMyAccess(
        IMemberAccessService access, ICurrentUser caller, CancellationToken ct)
    {
        var a = await access.GetAsync(caller.MemberId, ct);
        var s = a.State;
        return TypedResults.Ok(new MemberAccessDto(
            s.IsTrialEnabled, s.TrialDays, ToDate(s.TrialStartedOn), ToDate(s.TrialEndsOn),
            s.TrialDaysLeft, s.IsPaid, s.IsLocked, s.MembershipYear,
            a.Features.Select(f => new MemberAccessFeatureDto(f.FeatureKey, f.DisplayName, f.IsOpen)).ToList()));
    }

    private static async Task<Results<Ok<AppSettingsDto>, ProblemHttpResult>> GetSettings(
        IAppSettingsRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var r = await repo.GetSettingsAsync(caller.MemberId, ct);
            return TypedResults.Ok(new AppSettingsDto(
                r.Header.IsTrialEnabled, r.Header.TrialDays, r.Header.UpdatedByGiftName, r.Header.UpdatedDate,
                r.Features.Select(f => new AppSettingsFeatureDto(
                    f.FeatureKey, f.DisplayName, f.Description, f.IsAlwaysOpen, f.IsOpenAfterTrial)).ToList(),
                new AppSettingsPreviewDto(
                    r.Preview.TotalMembers, r.Preview.PaidMembers, r.Preview.InTrialMembers, r.Preview.TrialOverMembers)));
        }
        catch (AppSettingsException ex)
        {
            return ToProblem(ex);
        }
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> UpdateSettings(
        UpdateAppSettingsRequest req, IAppSettingsRepository repo, IMemberAccessService access,
        ICurrentUser caller, IValidator<UpdateAppSettingsRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.SetSettingsAsync(caller.MemberId, req.IsTrialEnabled, req.TrialDays, req.OpenFeatureKeys, ct);
        }
        catch (AppSettingsException ex)
        {
            return ToProblem(ex);
        }

        // Everyone's cached access state may have changed.
        access.Invalidate();
        return TypedResults.NoContent();
    }

    private static ProblemHttpResult ToProblem(AppSettingsException ex) => TypedResults.Problem(
        detail: ex.Message,
        statusCode: ex.Category == AppSettingsErrorCategory.Forbidden
            ? StatusCodes.Status403Forbidden : StatusCodes.Status400BadRequest);

    private static DateOnly? ToDate(DateTime? d) => d is null ? null : DateOnly.FromDateTime(d.Value);
}
