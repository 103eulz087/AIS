using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Akrho.Infrastructure.Storage;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Expenses;

public static class ExpensesEndpoints
{
    public static IEndpointRouteBuilder MapExpenses(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/expenses")
                   .WithTags("Expenses").RequireAuthorization();

        g.MapGet("", List).WithName("ListExpenses");
        g.MapGet("/{expenseId:int}", Get).WithName("GetExpense");

        // dbo.ExpenseAttachment.AttachmentId is its own id space, distinct from
        // AttachmentStagingId — this is NOT GET /api/attachments/{id}. Any member of the
        // chapter may view a receipt already attached to an expense (the receipt documents
        // a record the whole chapter can already read — same visibility as the expense).
        g.MapGet("/{expenseId:int}/attachments/{attachmentId:int}", DownloadAttachment)
            .WithName("DownloadExpenseAttachment");

        g.MapPost("", Create).WithName("CreateExpense")
            .RequireAuthorization(AuthorizationPolicies.ChapterMoneyWrite);

        // Narrower than ChapterMoneyWrite — ChapterAdmin only, same reasoning as
        // usp_Expense_Void's own role check (an irreversible correction to money already
        // posted and already disclosed to the whole chapter's ledger).
        g.MapPost("/{expenseId:int}/void", Void).WithName("VoidExpense")
            .RequireAuthorization(AuthorizationPolicies.ChapterMoneyVoid);

        return app;
    }

    private static async Task<Results<Ok<PagedResult<ExpenseListItemDto>>, ProblemHttpResult>> List(
        int chapterId, [AsParameters] ExpenseListRequest req,
        IExpenseRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetByChapterAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take,
                req.ActivityId, req.CategoryId, req.FromDate, req.ToDate, req.IncludeVoided, ct);

            var items = rows.Select(r => new ExpenseListItemDto(
                r.ExpenseId, r.ActivityId, r.ActivityName, DateOnly.FromDateTime(r.ExpenseDate), r.Payee,
                r.Description, r.Amount, r.CategoryId, r.CategoryName, r.RecordedBy, r.ApprovedBy, r.IsDeleted)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<ExpenseListItemDto>(items, total, req.Skip, req.Take));
        }
        catch (ExpenseException ex)
        {
            // usp_Expense_GetByChapter only ever rejects a caller who is not an active
            // member of the chapter — unreachable in the normal case since IScopeGuard
            // already confirmed the caller's own chapter matches the route, but the
            // procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<ExpenseDetailDto>, NotFound>> Get(
        int chapterId, int expenseId,
        IExpenseRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var detail = await repo.GetAsync(expenseId, caller.MemberId, ct);

            var attachments = detail.Attachments
                .Select(a => new ExpenseAttachmentDto(a.AttachmentId, a.FileName, a.FileSize, a.UploadedBy))
                .ToList();

            var voidHistory = detail.VoidHistory
                .Select(v => new ExpenseVoidDto(v.ExpenseVoidId, v.VoidedBy, v.VoidedDate, v.Reason, v.ReversedLedgerEntryId))
                .ToList();

            var h = detail.Header;
            var dto = new ExpenseDetailDto(
                h.ExpenseId, h.ChapterId, h.ActivityId, h.ActivityName, DateOnly.FromDateTime(h.ExpenseDate),
                h.Payee, h.Description, h.Amount, h.CategoryId, h.CategoryName, h.RecordedBy, h.ApprovedBy,
                h.IsDeleted, attachments, voidHistory);

            return TypedResults.Ok(dto);
        }
        catch (ExpenseException)
        {
            // usp_Expense_Get throws the SAME "Expense not found" message for a nonexistent
            // id and for a wrong-chapter caller — deliberate anti-enumeration.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<FileStreamHttpResult, NotFound>> DownloadAttachment(
        int chapterId, int expenseId, int attachmentId,
        IExpenseRepository repo, IFileStorage storage, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var row = await repo.GetAttachmentForDownloadAsync(expenseId, attachmentId, caller.MemberId, ct);
            var stream = await storage.OpenReadAsync(row.FilePath, ct);
            return TypedResults.Stream(stream, row.ContentType ?? "application/octet-stream", row.FileName);
        }
        catch (ExpenseException)
        {
            // Same "not found" for a bad id, an attachment belonging to a different
            // expense, and a wrong-chapter caller — anti-enumeration, same posture as
            // GET /api/attachments/{id}.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<ExpenseCreatedDto>, ValidationProblem, BadRequest<string>, ProblemHttpResult>> Create(
        int chapterId, CreateExpenseRequest req,
        IExpenseRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<CreateExpenseRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.CreateAsync(
                chapterId, caller.MemberId, req.Payee, req.Amount, req.ExpenseDate,
                req.CategoryId, req.ActivityId, req.Description, req.AttachmentStagingIds, ct);

            return TypedResults.Ok(new ExpenseCreatedDto(result.ExpenseId, result.LedgerEntryId));
        }
        catch (ExpenseException ex)
        {
            return ex.Category switch
            {
                // A non-positive amount, no attachment, an unrecognised category/activity,
                // or an attachment that is missing/consumed/foreign to this chapter — the
                // procedure's own message, written for whoever is filing the expense.
                ExpenseErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // Only ever a role check — ChapterMoneyWrite already blocked this for
                // anyone but a ChapterTreasurer/ChapterAdmin.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<VoidExpenseResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Void(
        int chapterId, int expenseId, VoidExpenseRequest req,
        IExpenseRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<VoidExpenseRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.VoidAsync(expenseId, req.Reason, caller.MemberId, ct);
            return TypedResults.Ok(new VoidExpenseResponseDto(result.ExpenseId, result.ReversedLedgerEntryId));
        }
        catch (ExpenseException ex)
        {
            return ex.Category switch
            {
                ExpenseErrorCategory.NotFound => TypedResults.NotFound(),
                // Already voided — the resource's state changed under the caller, nothing
                // about the request itself was invalid — 409, not 400.
                ExpenseErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // The procedure's own "at least 10 characters" message.
                ExpenseErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
