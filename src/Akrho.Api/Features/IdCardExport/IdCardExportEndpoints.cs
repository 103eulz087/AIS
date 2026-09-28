using System.IO.Compression;
using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Akrho.Infrastructure.Storage;
using Microsoft.AspNetCore.Http.HttpResults;
using NPOI.HSSF.UserModel;
using SkiaSharp;

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
            WriteWorkbookEntry(archive, members, webOrigin);
            await WritePhotoEntriesAsync(archive, members, storage, logger, ct);
        }

        return zipStream.ToArray();
    }

    // NPOI's HSSFWorkbook, not ClosedXML — client decision 2026-09-26: the Magicard
    // Enduro's own bundled card-design software looks up its data source by a plain
    // file lookup and only understands the legacy binary .xls (BIFF) format, not the
    // OOXML .xlsx ClosedXML produces (that library has no .xls writer at all — a
    // different library was the only way to honour this). Every downstream mail-merge
    // field on the printer's own template stays keyed to these exact column headers;
    // do not reorder or rename them without checking that template first.
    private static void WriteWorkbookEntry(
        ZipArchive archive, IReadOnlyList<IdCardExportMemberRow> members, string webOrigin)
    {
        using var workbook = new HSSFWorkbook();
        var sheet = workbook.CreateSheet("Members");

        string[] headers =
        [
            "MemberNumber", "FirstName", "MiddleName", "LastName", "GiftName", "BloodTypeName",
            "ChapterName", "ChapterCode", "StatusName", "PhotoFileName", "VerificationUrl"
        ];
        var headerRow = sheet.CreateRow(0);
        for (var col = 0; col < headers.Length; col++)
            headerRow.CreateCell(col).SetCellValue(headers[col]);

        var rowIndex = 1;
        foreach (var m in members)
        {
            // Always ".jpg" — never the source upload's own extension. See
            // WritePhotoEntriesAsync's own header comment for why every photo entry is
            // re-encoded to match, not just renamed.
            var photoFileName = PhotoFileName(m);

            // Built EXACTLY the way CredentialEndpoints.ToDto builds the self-service Digital
            // ID's own VerificationUrl — a relative "/verify/{tokenSubject:D}" path, resolved
            // here against Web:Origin the same way MembersEndpoints.ReissueEnrolmentLink
            // already resolves an enrolment link against that same config key. Blank (not a
            // broken/placeholder link) for any row whose TokenSubject never came back — i.e.
            // the required bulk-issue call above was skipped or failed for that member.
            var verificationUrl = m.TokenSubject is { } subject
                ? $"{webOrigin}/verify/{subject:D}"
                : null;

            var row = sheet.CreateRow(rowIndex);
            row.CreateCell(0).SetCellValue(m.MemberNumber);
            row.CreateCell(1).SetCellValue(m.FirstName);
            row.CreateCell(2).SetCellValue(m.MiddleName ?? string.Empty);
            row.CreateCell(3).SetCellValue(m.LastName);
            row.CreateCell(4).SetCellValue(m.GiftName);
            row.CreateCell(5).SetCellValue(m.BloodTypeName ?? string.Empty);
            row.CreateCell(6).SetCellValue(m.ChapterName);
            row.CreateCell(7).SetCellValue(m.ChapterCode ?? string.Empty);
            row.CreateCell(8).SetCellValue(m.StatusName);
            row.CreateCell(9).SetCellValue(photoFileName ?? string.Empty);
            row.CreateCell(10).SetCellValue(verificationUrl ?? string.Empty);
            rowIndex++;
        }

        for (var col = 0; col < headers.Length; col++)
            sheet.AutoSizeColumn(col);

        var entry = archive.CreateEntry("members.xls", CompressionLevel.Optimal);
        using var entryStream = entry.Open();
        workbook.Write(entryStream, leaveOpen: true);
    }

    // Every photo entry is re-encoded to JPEG here, regardless of what format the member's
    // photo was actually uploaded/stored as (a phone upload can just as easily be .png or
    // .heic — see MembersEndpoints.AllowedPhotoContentTypes). Client decision 2026-09-26:
    // the Magicard Enduro's own card-design software looks up each member's photo by a
    // plain filename match against the workbook, with no way to also match against mixed
    // extensions — every entry under photos/ must be a REAL .jpg, not just a renamed copy
    // of whatever the original bytes were (a renamed .png would still be PNG-encoded on
    // disk and either fail that lookup or render as a broken image).
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

            await using (source)
            {
                byte[] jpegBytes;
                try
                {
                    jpegBytes = ReencodeToJpeg(source);
                }
                catch (Exception ex)
                {
                    // A corrupt/unrecognisable source file (or a format this build's Skia
                    // can't decode, e.g. some HEIC variants without the platform's own codec)
                    // — same "skip, don't fail the whole export" posture as a missing file.
                    logger.LogWarning(ex,
                        "ID card export: photo file for {MemberNumber} could not be re-encoded to JPEG — skipped, not failed",
                        m.MemberNumber);
                    continue;
                }

                var fileName = PhotoFileName(m)!;
                var entry = archive.CreateEntry($"photos/{fileName}", CompressionLevel.Optimal);
                await using var entryStream = entry.Open();
                await entryStream.WriteAsync(jpegBytes, ct);
            }
        }
    }

    /// <summary>
    /// Decodes via SKCodec (not the simpler SKBitmap.Decode) specifically so
    /// EncodedOrigin — the source file's own EXIF rotation flag — can be read and baked
    /// into the actual pixel data before re-encoding. A phone photo is very often stored
    /// "sideways" with only an EXIF tag telling a viewer to rotate it on display; the
    /// Magicard software reads raw pixels off a plain file, the same way this method's own
    /// caller does, with no EXIF interpretation of its own, so a straight re-encode
    /// without correcting orientation first would print a sideways/upside-down photo on
    /// every card whose source happened to need it.
    /// </summary>
    private static byte[] ReencodeToJpeg(Stream source)
    {
        using var data = SKData.Create(source);
        using var codec = SKCodec.Create(data) ?? throw new InvalidOperationException("Not a recognisable image format.");

        using var raw = new SKBitmap(codec.Info.Width, codec.Info.Height);
        var result = codec.GetPixels(raw.Info, raw.GetPixels());
        if (result is not (SKCodecResult.Success or SKCodecResult.IncompleteInput))
            throw new InvalidOperationException($"Could not decode image pixels ({result}).");

        using var oriented = ApplyExifOrientation(raw, codec.EncodedOrigin);
        using var image = SKImage.FromBitmap(oriented);
        using var jpeg = image.Encode(SKEncodedImageFormat.Jpeg, 90);
        return jpeg.ToArray();
    }

    /// <summary>The 8 standard EXIF orientation values, each as the rotation/mirror it
    /// asks a viewer to apply. TopLeft (the common case — no tag, or "already upright")
    /// returns the same bitmap untouched.</summary>
    private static SKBitmap ApplyExifOrientation(SKBitmap source, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft) return source.Copy();

        var swapsDimensions = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var width = swapsDimensions ? source.Height : source.Width;
        var height = swapsDimensions ? source.Width : source.Height;

        var oriented = new SKBitmap(width, height);
        using var canvas = new SKCanvas(oriented);
        var matrix = origin switch
        {
            SKEncodedOrigin.TopRight => SKMatrix.CreateScale(-1, 1).PostConcat(SKMatrix.CreateTranslation(width, 0)),
            SKEncodedOrigin.BottomRight => SKMatrix.CreateRotationDegrees(180, width / 2f, height / 2f),
            SKEncodedOrigin.BottomLeft => SKMatrix.CreateScale(1, -1).PostConcat(SKMatrix.CreateTranslation(0, height)),
            SKEncodedOrigin.LeftTop => SKMatrix.Concat(
                SKMatrix.CreateRotationDegrees(90), SKMatrix.CreateScale(1, -1)),
            SKEncodedOrigin.RightTop => SKMatrix.CreateRotationDegrees(90, width / 2f, height / 2f)
                .PostConcat(SKMatrix.CreateTranslation((width - height) / 2f, (height - width) / 2f)),
            SKEncodedOrigin.RightBottom => SKMatrix.Concat(
                SKMatrix.CreateRotationDegrees(270), SKMatrix.CreateScale(1, -1)),
            SKEncodedOrigin.LeftBottom => SKMatrix.CreateRotationDegrees(270, width / 2f, height / 2f)
                .PostConcat(SKMatrix.CreateTranslation((width - height) / 2f, (height - width) / 2f)),
            _ => SKMatrix.Identity,
        };
        canvas.SetMatrix(matrix);
        canvas.DrawBitmap(source, 0, 0, new SKSamplingOptions(SKFilterMode.Nearest, SKMipmapMode.None), paint: null);
        return oriented;
    }

    private static string? PhotoFileName(IdCardExportMemberRow m) =>
        m.PhotoPath is null ? null : $"{m.MemberNumber}.jpg";
}
