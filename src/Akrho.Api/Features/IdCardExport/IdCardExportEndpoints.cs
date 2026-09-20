using System.IO.Compression;
using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Akrho.Infrastructure.Storage;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.IdCardExport;

/// <summary>
/// National ID card export — a ZIP (spreadsheet + member photos) for the National Council's
/// CouncilAdmin to bulk-print physical ID cards on a Magicard card printer. One GET, no
/// persisted resource of its own; see <see cref="MapIdCardExport"/> for the GET-vs-POST call.
/// </summary>
public static class IdCardExportEndpoints
{
    public static IEndpointRouteBuilder MapIdCardExport(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/id-card-exports").WithTags("IdCardExport").RequireAuthorization();

        // GET, with an optional ?chapterId= filter, not POST. This call DOES have a side
        // effect (usp_Credential_BulkIssueForExport bulk-issues any missing credentials), but
        // that side effect is purely additive and fully idempotent — a repeat call issues zero
        // new credentials for a member already covered (that procedure's own header comment) —
        // so to both the caller and the browser this behaves like a plain file download, not a
        // state-changing action. That lets the frontend trigger it with a direct navigation
        // (<a href>/window.location) instead of a POST-then-blob dance in JS. chapterId is a
        // read filter only, never a trust boundary: the caller is already a National
        // CouncilAdmin with visibility across every chapter (usp_Member_ListForIdCardExport's
        // own header — there is no per-chapter subtree walk because a National seat already
        // covers the whole tree), so unlike a chapter-scoped endpoint there is no
        // IScopeGuard-style narrowing to bypass here.
        //
        // AuthorizationPolicies.CouncilChapterRegistrationApprove is reused rather than adding
        // a new policy — it already is exactly "must hold CouncilAdmin, on some council"
        // (Program.cs: RequireRole("CouncilAdmin")). This is defence-in-depth only: the
        // procedures' own 51581 check is what actually restricts this export to the National
        // CouncilAdmin specifically. A CouncilAdmin seated on any OTHER council clears this
        // policy and is then rejected by the procedure itself (mapped to 403 below).
        g.MapGet("", Export).WithName("ExportIdCards")
            .RequireAuthorization(AuthorizationPolicies.CouncilChapterRegistrationApprove);

        return app;
    }

    private static async Task<Results<FileContentHttpResult, ProblemHttpResult>> Export(
        int? chapterId, IIdCardExportRepository repo, IFileStorage storage, IConfiguration config,
        ICurrentUser caller, ILoggerFactory loggerFactory, CancellationToken ct)
    {
        // IdCardExportEndpoints is a static class — can't be an ILogger<T> type argument, so
        // this follows the same string-category convention ExceptionHandling.cs already uses
        // rather than introducing a marker type just to satisfy the generic.
        var logger = loggerFactory.CreateLogger("Akrho.Api.Features.IdCardExport");
        try
        {
            // Bulk-issue FIRST, same (RequestingMemberId, ChapterId) pair, in the same
            // request as the list call below — what makes TokenSubject come back non-null for
            // every row in practice (both procedures' own header comments).
            // caller.MemberId only — never a value from the request (CLAUDE.md invariant #4/#11).
            await repo.BulkIssueCredentialsAsync(caller.MemberId, chapterId, expiryDate: null, ct);
            var members = await repo.ListForExportAsync(caller.MemberId, chapterId, ct);

            var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
            var zipBytes = await BuildZipAsync(members, storage, webOrigin, logger, ct);

            var fileName = $"id-cards-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip";
            return TypedResults.File(zipBytes, "application/zip", fileName);
        }
        catch (IdCardExportException ex)
        {
            return ex.Category switch
            {
                // Caller holds CouncilAdmin somewhere, but not on the National Council —
                // unreachable for the true National Admin, but a CouncilAdmin seated
                // elsewhere clears this endpoint's own policy (any council) and is rejected
                // here by the procedure's own tighter, National-specific check.
                IdCardExportErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),

                // The National Council row itself isn't seeded/configured yet — not the
                // caller's fault, and not fixable by retrying the same request.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict)
            };
        }
    }

    private static async Task<byte[]> BuildZipAsync(
        IReadOnlyList<IdCardExportMemberRow> members, IFileStorage storage, string webOrigin,
        ILogger logger, CancellationToken ct)
    {
        using var zipStream = new MemoryStream();

        using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteWorkbookEntry(archive, members, storage, webOrigin);
            await WritePhotoEntriesAsync(archive, members, storage, logger, ct);
        }

        return zipStream.ToArray();
    }

    private static void WriteWorkbookEntry(
        ZipArchive archive, IReadOnlyList<IdCardExportMemberRow> members, IFileStorage storage, string webOrigin)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Members");

        string[] headers =
        [
            "MemberNumber", "FirstName", "MiddleName", "LastName", "GiftName", "BloodTypeName",
            "ChapterName", "ChapterCode", "StatusName", "PhotoFileName", "VerificationUrl"
        ];
        for (var col = 0; col < headers.Length; col++)
            sheet.Cell(1, col + 1).Value = headers[col];

        var row = 2;
        foreach (var m in members)
        {
            var photoFileName = PhotoFileName(m, storage);

            // Built EXACTLY the way CredentialEndpoints.ToDto builds the self-service Digital
            // ID's own VerificationUrl — a relative "/verify/{tokenSubject:D}" path, resolved
            // here against Web:Origin the same way MembersEndpoints.ReissueEnrolmentLink
            // already resolves an enrolment link against that same config key. Blank (not a
            // broken/placeholder link) for any row whose TokenSubject never came back — i.e.
            // the required bulk-issue call above was skipped or failed for that member.
            var verificationUrl = m.TokenSubject is { } subject
                ? $"{webOrigin}/verify/{subject:D}"
                : null;

            sheet.Cell(row, 1).Value = m.MemberNumber;
            sheet.Cell(row, 2).Value = m.FirstName;
            sheet.Cell(row, 3).Value = m.MiddleName ?? string.Empty;
            sheet.Cell(row, 4).Value = m.LastName;
            sheet.Cell(row, 5).Value = m.GiftName;
            sheet.Cell(row, 6).Value = m.BloodTypeName ?? string.Empty;
            sheet.Cell(row, 7).Value = m.ChapterName;
            sheet.Cell(row, 8).Value = m.ChapterCode ?? string.Empty;
            sheet.Cell(row, 9).Value = m.StatusName;
            sheet.Cell(row, 10).Value = photoFileName ?? string.Empty;
            sheet.Cell(row, 11).Value = verificationUrl ?? string.Empty;
            row++;
        }

        sheet.Columns().AdjustToContents();

        var entry = archive.CreateEntry("members.xlsx", CompressionLevel.Optimal);
        using var entryStream = entry.Open();
        workbook.SaveAs(entryStream);
    }

    private static async Task WritePhotoEntriesAsync(
        ZipArchive archive, IReadOnlyList<IdCardExportMemberRow> members, IFileStorage storage,
        ILogger logger, CancellationToken ct)
    {
        foreach (var m in members)
        {
            if (m.PhotoPath is null) continue; // no photo — no file, no error, no placeholder

            // Photo storage is local to each deployment (LocalFileStorage), never shared —
            // dbo.Member.PhotoPath comes from the shared database, but the file it names may
            // simply not exist on THIS environment's disk (e.g. local dev pointed at the same
            // dev database a staging upload just wrote to; or, in a single environment, a file
            // genuinely lost from disk). One missing photo must never fail the whole export —
            // opened BEFORE the zip entry is created, so a failed read never leaves a
            // zero-byte/corrupt entry behind either.
            Stream source;
            try
            {
                source = await storage.OpenReadAsync(m.PhotoPath, ct);
            }
            catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException or UnauthorizedAccessException)
            {
                logger.LogWarning(ex,
                    "ID card export: photo file for {MemberNumber} is missing on this environment's disk — skipped, not failed",
                    m.MemberNumber);
                continue;
            }

            // A renamed COPY for this export only. The actual stored file keeps its own
            // server-generated GUID name (LocalFileStorage's path-traversal/enumeration
            // defence) — this never touches or renames dbo.Member.PhotoPath or the file on
            // disk it points to.
            await using (source)
            {
                var fileName = PhotoFileName(m, storage)!;
                var entry = archive.CreateEntry($"photos/{fileName}", CompressionLevel.Optimal);
                await using var entryStream = entry.Open();
                await source.CopyToAsync(entryStream, ct);
            }
        }
    }

    // Same extension table LocalFileStorage.SaveAsync already uses internally
    // (IFileStorage.ResolveExtension) — never a second, independently-maintained jpg/png/heic
    // mapping.
    private static string? PhotoFileName(IdCardExportMemberRow m, IFileStorage storage) =>
        m.PhotoPath is null ? null : $"{m.MemberNumber}{storage.ResolveExtension(m.PhotoContentType)}";
}
