using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Tutorials;

/// <summary>GET /api/members/me/tutorials — one tour the caller has finished or skipped.</summary>
public sealed record MemberTutorialDto(string TourKey, int TourVersion, string Outcome, DateTime FinishedDate);

/// <summary>POST /api/members/me/tutorials/{tourKey}/finish. Outcome is Completed or Skipped.</summary>
public sealed record FinishTutorialRequest(int TourVersion, string Outcome);

public sealed class FinishTutorialRequestValidator : AbstractValidator<FinishTutorialRequest>
{
    public FinishTutorialRequestValidator()
    {
        RuleFor(x => x.TourVersion).GreaterThanOrEqualTo(1)
            .WithMessage("The tour version must be 1 or more.");
        RuleFor(x => x.Outcome).Must(o => o is "Completed" or "Skipped")
            .WithMessage("The outcome must be Completed or Skipped.");
    }
}

/// <summary>
/// First-login guided tours (db/schema/31_member_tutorial.sql). The web app asks which tours
/// the member has already seen and records a finish or skip, so the tour shows once per
/// member on any device. Own data only — the member id is the JWT's, never the request's.
/// Never gated by RequireFeature: a member whose free trial is over still gets his tour.
/// </summary>
public static class TutorialsEndpoints
{
    public static IEndpointRouteBuilder MapTutorials(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/members/me/tutorials").WithTags("Tutorials").RequireAuthorization();
        g.MapGet("", GetMine).WithName("GetMyTutorials");
        g.MapPost("/{tourKey}/finish", Finish).WithName("FinishTutorial");
        return app;
    }

    private static async Task<Ok<List<MemberTutorialDto>>> GetMine(
        IMemberTutorialRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        var rows = await repo.GetMineAsync(caller.MemberId, ct);
        return TypedResults.Ok(rows.Select(r => new MemberTutorialDto(
            r.TourKey, r.TourVersion, r.Outcome, DateTime.SpecifyKind(r.FinishedDate, DateTimeKind.Utc))).ToList());
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> Finish(
        string tourKey, FinishTutorialRequest req, IMemberTutorialRepository repo, ICurrentUser caller,
        IValidator<FinishTutorialRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());
        if (string.IsNullOrWhiteSpace(tourKey) || tourKey.Length > 40)
            return TypedResults.Problem(detail: "That tour was not recognised.", statusCode: StatusCodes.Status400BadRequest);

        try
        {
            await repo.FinishAsync(caller.MemberId, tourKey, req.TourVersion, req.Outcome, ct);
            return TypedResults.NoContent();
        }
        catch (MemberTutorialException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest);
        }
    }
}
