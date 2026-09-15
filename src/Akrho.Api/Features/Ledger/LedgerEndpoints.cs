using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Ledger;

public sealed record LedgerEntryDto(
    int LedgerEntryId, DateOnly EntryDate, string EntryType, decimal Amount,
    string Description, string SourceType, int? SourceId, string? ActivityName,
    bool IsReversal, int? ReversesEntryId);

public sealed record LedgerSummaryDto(decimal CashIn, decimal CashOut, decimal Balance);

public sealed record ReverseRequest(string Reason);

public static class LedgerEndpoints
{
    public static IEndpointRouteBuilder MapLedger(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/ledger")
                   .WithTags("Ledger").RequireAuthorization();

        g.MapGet("", Get).WithName("GetLedger");
        g.MapGet("/summary", GetSummary).WithName("GetLedgerSummary");

        g.MapPost("/{entryId:int}/reverse", Reverse).WithName("ReverseLedgerEntry")
            .RequireAuthorization(AuthorizationPolicies.ChapterLedgerCorrect);

        // There is deliberately no PUT and no DELETE on this resource.
        // The ledger is append-only; the database rejects both regardless.
        return app;
    }

    private static async Task<Results<Ok<PagedResult<LedgerEntryDto>>, ProblemHttpResult>> Get(
        int chapterId, DateOnly? from, DateOnly? to, int? skip, int? take,
        ILedgerRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var effectiveSkip = skip ?? 0;
        var effectiveTake = take is null or 0 ? 100 : take.Value;

        try
        {
            var rows = await repo.GetByChapterAsync(
                caller.MemberId, chapterId, from, to, effectiveSkip, effectiveTake, ct);

            var items = rows.Select(r => new LedgerEntryDto(
                r.LedgerEntryId, DateOnly.FromDateTime(r.EntryDate), r.EntryType, r.Amount,
                r.Description, r.SourceType, r.SourceId, r.ActivityName,
                r.IsReversal, r.ReversesEntryId)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<LedgerEntryDto>(items, total, effectiveSkip, effectiveTake));
        }
        catch (LedgerException ex)
        {
            // usp_Ledger_GetByChapter only ever rejects a caller who is not an active
            // member of the chapter — unreachable in the normal case, since IScopeGuard
            // already confirmed the caller's own chapter matches the route, but the
            // procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<LedgerSummaryDto>, ProblemHttpResult>> GetSummary(
        int chapterId, ILedgerRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var s = await repo.GetSummaryAsync(caller.MemberId, chapterId, ct);
            return TypedResults.Ok(new LedgerSummaryDto(s.CashIn, s.CashOut, s.Balance));
        }
        catch (LedgerException ex)
        {
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<int>, BadRequest<string>, NotFound, Conflict<string>, ProblemHttpResult>> Reverse(
        int chapterId, int entryId, ReverseRequest body,
        ILedgerRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        if (string.IsNullOrWhiteSpace(body.Reason))
            return TypedResults.BadRequest("A reversal needs a reason. It stays visible beside the original entry.");

        try
        {
            // No separate "requester vs. performer" distinction in this system — the
            // caller is both.
            var newId = await repo.ReverseAsync(entryId, body.Reason, caller.MemberId, caller.MemberId, ct);
            return TypedResults.Ok(newId);
        }
        catch (LedgerException ex)
        {
            return ex.Category switch
            {
                LedgerErrorCategory.NotFound => TypedResults.NotFound(),
                // The entry's state changed under the caller (already reversed) —
                // nothing about the request itself was invalid — 409, not 400.
                LedgerErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // The ChapterLedgerCorrect policy already blocked this for anyone but a
                // ChapterTreasurer/ChapterAdmin; this is the procedure's own layer
                // (defence in depth) — same message the procedure wrote for the officer.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
