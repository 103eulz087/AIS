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
        g.MapPost("/{entryId:int}/reverse", Reverse).WithName("ReverseLedgerEntry");

        // There is deliberately no PUT and no DELETE on this resource.
        // The ledger is append-only; the database rejects both regardless.
        return app;
    }

    private static async Task<Ok<PagedResult<LedgerEntryDto>>> Get(
        int chapterId, DateOnly? from, DateOnly? to, int skip, int take,
        ILedgerRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var rows = await repo.GetByChapterAsync(
            caller.MemberId, chapterId, from, to, skip, take == 0 ? 100 : take, ct);

        var items = rows.Select(r => new LedgerEntryDto(
            r.LedgerEntryId, DateOnly.FromDateTime(r.EntryDate), r.EntryType, r.Amount,
            r.Description, r.SourceType, r.SourceId, r.ActivityName,
            r.IsReversal, r.ReversesEntryId)).ToList();

        var total = rows.Count > 0 ? rows[0].TotalCount : 0;
        return TypedResults.Ok(new PagedResult<LedgerEntryDto>(items, total, skip, take));
    }

    private static async Task<Results<Ok<int>, BadRequest<string>>> Reverse(
        int chapterId, int entryId, ReverseRequest body,
        ILedgerRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        if (string.IsNullOrWhiteSpace(body.Reason))
            return TypedResults.BadRequest("A reversal needs a reason. It stays visible beside the original entry.");

        var newId = await repo.ReverseAsync(entryId, body.Reason, caller.MemberId, ct);
        return TypedResults.Ok(newId);
    }
}
