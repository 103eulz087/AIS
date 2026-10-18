using Akrho.Infrastructure.Security;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.AppSettings;

/// <summary>
/// The free-trial gate. Once a member's trial is over (and the trial is switched on), only
/// the features National left open stay usable; every other gated route answers 403 with
/// code "trial-ended". Anonymous callers and tokens with no member id pass straight through,
/// so public endpoints are unaffected. Never mentions an amount owed (invariant #5).
/// </summary>
public sealed class RequireFeatureFilter(string featureKey, bool exemptCouncilOfficers = false) : IEndpointFilter
{
    public const string Title = "Free trial ended";
    public const string Detail =
        "Your free trial has ended. This part of the app opens again once your membership payment for this year is recorded.";
    public const string Code = "trial-ended";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated != true) return await next(context);

        var caller = http.RequestServices.GetRequiredService<ICurrentUser>();
        if (caller.MemberId <= 0) return await next(context);
        // A route the Portal shares with the member app: council work is never gated.
        if (exemptCouncilOfficers && caller.IsCouncilOfficer) return await next(context);

        var access = await http.RequestServices.GetRequiredService<IMemberAccessService>()
            .GetAsync(caller.MemberId, http.RequestAborted);
        if (access.IsFeatureOpen(featureKey)) return await next(context);

        return TypedResults.Problem(
            title: Title, detail: Detail, statusCode: StatusCodes.Status403Forbidden,
            extensions: new Dictionary<string, object?> { ["code"] = Code, ["featureKey"] = featureKey });
    }
}

public static class RequireFeatureExtensions
{
    /// <summary>Gates a route group or a single endpoint behind the free-trial rule for
    /// <paramref name="featureKey"/> (use the constants in <see cref="AppFeatures"/>). Set
    /// <paramref name="exemptCouncilOfficers"/> on an endpoint the Portal also calls (e.g. a
    /// council re-issuing a chapter officer's enrolment link): the Portal is never gated.</summary>
    public static TBuilder RequireFeature<TBuilder>(this TBuilder builder, string featureKey, bool exemptCouncilOfficers = false)
        where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(new RequireFeatureFilter(featureKey, exemptCouncilOfficers));
}
