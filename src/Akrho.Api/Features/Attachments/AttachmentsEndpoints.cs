using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Akrho.Infrastructure.Storage;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Attachments;

public sealed record AttachmentStagedDto(int AttachmentStagingId);

/// <summary>
/// Stage-then-claim file attachments. There is no browse-all-attachments endpoint and none
/// is planned — the only two operations are staging a receipt for an about-to-be-created
/// expense, and downloading one file you are scoped to see.
/// </summary>
public static class AttachmentsEndpoints
{
    // A phone photo of a receipt typically runs 2-6 MB; 8 MB leaves headroom for a
    // high-resolution shot or a multi-page scanned PDF without opening the door to
    // arbitrarily large uploads eating chapter storage.
    private const long MaxFileSizeBytes = 8L * 1024 * 1024;

    private static readonly HashSet<string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/heic", "application/pdf"
    };

    public static IEndpointRouteBuilder MapAttachments(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/attachments").WithTags("Attachments").RequireAuthorization();

        // Staging is gated at the same bar as the one thing a staged attachment can ever
        // become — an expense's receipt (ChapterTreasurer/ChapterAdmin, docs §3.1, §4.6:
        // "receipt uploads" belong to the Treasurer). Leaving staging open to every member
        // would let anyone fill the chapter's storage with files nobody but the treasurer
        // or admin could ever attach to anything.
        g.MapPost("", Upload).WithName("UploadAttachment")
            .RequireAuthorization(AuthorizationPolicies.ChapterMoneyWrite)
            .RequireRateLimiting(RateLimiting.AttachmentUpload)
            .DisableAntiforgery();

        // Download carries no extra policy beyond "signed in" — a receipt attached to an
        // expense is chapter-transparent, the same visibility as the expense it documents
        // (docs §4.6). The scope check (same chapter as the file) happens inside the proc.
        g.MapGet("/{attachmentStagingId:int}", Download).WithName("DownloadAttachment");

        return app;
    }

    private static async Task<Results<Ok<AttachmentStagedDto>, BadRequest<string>>> Upload(
        IFormFile? file, IFileStorage storage, IAttachmentRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return TypedResults.BadRequest("Choose a file to upload.");

        if (file.Length > MaxFileSizeBytes)
            return TypedResults.BadRequest("That file is too large. Photos and PDFs up to 8 MB are accepted.");

        if (!AllowedContentTypes.Contains(file.ContentType))
            return TypedResults.BadRequest("Only JPEG, PNG, HEIC photos or PDF files are accepted.");

        await using var stream = file.OpenReadStream();
        var stored = await storage.SaveAsync(stream, file.FileName, file.ContentType, ct);

        // ChapterId and UploadedBy come from the caller's own token, never from the
        // request (CLAUDE.md invariant #11) — there is no chapterId anywhere in this call.
        // The client's original filename is kept only for display, never for the path.
        var displayName = Path.GetFileName(file.FileName);
        var attachmentStagingId = await repo.StageAsync(
            caller.ChapterId, caller.MemberId, stored.RelativePath, displayName,
            stored.FileSize, file.ContentType, ct);

        return TypedResults.Ok(new AttachmentStagedDto(attachmentStagingId));
    }

    private static async Task<Results<FileStreamHttpResult, NotFound>> Download(
        int attachmentStagingId, IAttachmentRepository repo, IFileStorage storage, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var row = await repo.GetForDownloadAsync(attachmentStagingId, caller.MemberId, ct);
            var stream = await storage.OpenReadAsync(row.FilePath, ct);
            return TypedResults.Stream(stream, row.ContentType ?? "application/octet-stream", row.FileName);
        }
        catch (AttachmentException)
        {
            // Same "not found" for a bad id and for a member of a different chapter —
            // anti-enumeration, same pattern as usp_Expense_Get / usp_Meeting_Get. A member
            // of another chapter must get this, never the file.
            return TypedResults.NotFound();
        }
    }
}
