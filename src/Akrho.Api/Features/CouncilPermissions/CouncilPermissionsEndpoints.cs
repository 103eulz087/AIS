using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.CouncilPermissions;

/// <summary>
/// Phase 1 "dynamic council office permissions" — reading and editing one council's own
/// permission grid (which office may do what, on that council). Deliberately its own feature
/// folder, separate from CouncilsEndpoints (registration/seating) and CouncilStatisticsEndpoints
/// (read-only rollups): this is about what a seated office is ALLOWED to do, not who is seated
/// or how the council is doing.
///
/// CLAUDE.md invariant #4/#11 discipline throughout: councilId always arrives in the route, but
/// is never trusted as authorization on its own — usp_CouncilPermission_GetGrid/_Set each
/// re-derive the caller's own real standing against @CouncilId server-side (fn_MemberCouncilScope
/// for read, a live PRESIDING seat on that EXACT council for write). The RequireAuthorization
/// policy on each route is the coarse, ROLE-only pre-check; the procedure is the real authority.
/// </summary>
public static class CouncilPermissionsEndpoints
{
    public static IEndpointRouteBuilder MapCouncilPermissions(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/councils").WithTags("CouncilPermissions");

        g.MapGet("/{councilId:int}/permissions", GetGrid).WithName("GetCouncilPermissionGrid")
            .RequireAuthorization(AuthorizationPolicies.CouncilPermissionsRead);

        g.MapPut("/{councilId:int}/permissions", UpdatePermissions).WithName("UpdateCouncilPermissions")
            .RequireAuthorization(AuthorizationPolicies.CouncilPermissionsManage);

        return app;
    }

    private static async Task<Results<Ok<CouncilPermissionGridDto>, NotFound, ProblemHttpResult>> GetGrid(
        int councilId, ICouncilPermissionRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        // Defence in depth before the round trip even happens — a bare existence check only
        // (viewing reaches into the caller's own subtree, not just his directly-seated
        // councils, same posture as CouncilStatisticsEndpoints.Get). The procedure's own
        // fn_MemberCouncilScope check (51930) remains the actual authority.
        scope.EnsureAnyCouncilSeat(caller);

        try
        {
            var rows = await repo.GetGridAsync(caller.MemberId, councilId, ct);
            return TypedResults.Ok(Map(rows));
        }
        catch (CouncilPermissionException ex) when (ex.Category == CouncilPermissionErrorCategory.NotFound)
        {
            // 51930 — same anti-enumeration posture as usp_Council_GetRegistry/_GetRoster: a
            // council id outside the caller's view looks identical to one that doesn't exist.
            return TypedResults.NotFound();
        }
        catch (CouncilPermissionException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<UpdateCouncilPermissionsResponseDto>, ValidationProblem, NotFound, ProblemHttpResult>> UpdatePermissions(
        int councilId, UpdateCouncilPermissionsRequest req,
        ICouncilPermissionRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<UpdateCouncilPermissionsRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        // Defence in depth — editing requires a live seat on this EXACT council (never a
        // parent's), so the coarse CouncilIds check is the right shape here, unlike GetGrid's
        // subtree-aware view. The procedure's own PRESIDING-seat check (51931) is what
        // actually enforces it.
        scope.EnsureCouncil(caller, councilId);

        var changes = req.Changes
            .Select(c => new CouncilPermissionChangeInput(c.CouncilOfficeId, c.PermissionKey, c.IsGranted))
            .ToList();

        try
        {
            var changedCount = await repo.SetAsync(caller.MemberId, councilId, changes, req.Reason, ct);
            return TypedResults.Ok(new UpdateCouncilPermissionsResponseDto(changedCount));
        }
        catch (CouncilPermissionException ex)
        {
            return ex.Category switch
            {
                CouncilPermissionErrorCategory.NotFound => TypedResults.NotFound(),
                CouncilPermissionErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static CouncilPermissionGridDto Map(CouncilPermissionGridRows rows) => new(
        new CouncilPermissionHeaderDto(rows.Header.CouncilId, rows.Header.CouncilName, rows.Header.IsNational, rows.Header.CanEdit),
        rows.Offices.Select(o => new CouncilPermissionOfficeDto(o.Id, o.Name, o.IsPresiding, o.IsReadOnly)).ToList(),
        rows.Permissions.Select(p => new CouncilPermissionKeyDto(
            p.PermissionKey, p.DisplayName, p.Description, p.IsWrite, p.IsNationalOnly, p.RequiresKey, p.SortOrder)).ToList(),
        rows.Cells.Select(c => new CouncilPermissionCellDto(
            c.CouncilOfficeId, c.PermissionKey, c.IsGranted, c.IsDefault, c.IsLocked, c.LockReason)).ToList(),
        rows.History.Select(h => new CouncilPermissionHistoryDto(
            h.HistoryId, h.CouncilOfficeId, h.OfficeName, h.PermissionKey, h.WasGranted, h.IsGranted,
            h.ChangedBy, h.ChangedByGiftName, h.ChangedDate, h.Reason)).ToList());
}
