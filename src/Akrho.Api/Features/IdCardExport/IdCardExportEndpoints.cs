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
/// National ID card export — two distinct export types, both National CouncilAdmin only,
/// both GETs with no persisted resource of their own:
///   GET /api/id-card-exports            — "Export Data": a ZIP (spreadsheet + member
///                                          photos) for the Magicard card printer.
///   GET /api/id-card-exports/digital-id — "Export Digital ID images" (added 2026-10-06):
///                                          a ZIP of rendered front/back PNGs per member,
///                                          via DigitalIdCardRenderer — see that file's
///                                          own header for why this is a second, by-hand
///                                          implementation of DigitalId.tsx's visual
///                                          design rather than a headless-browser
///                                          screenshot of it — plus a members.xls mail-merge
///                                          workbook (MemberNumber/FirstName/LastName/
///                                          FrontIdFileName/BackIdFileName, added 2026-10-06,
///                                          columns revised 2026-10-07) for the same Magicard
///                                          printer database Export Data's own workbook
///                                          feeds. Front/back PNGs live under FRONTIMAGE/
///                                          and BACKIMAGE/ respectively, each named by the
///                                          bare MemberNumber (added 2026-10-07) — no
///                                          "-front"/"-back" suffix needed once the two
///                                          faces are segregated by folder.
/// Neither shares a column contract with the other — see each repository row's own doc
/// comment before touching either.
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
        // AuthorizationPolicies.NationalIdCardExport (split out 2026-10-17, Phase 1 "dynamic
        // council office permissions" — see that constant's own comment) — exactly "must hold
        // CouncilSecretary or CouncilAdmin, on some council" (Program.cs). Split out of
        // CouncilChapterRegistrationApprove specifically so widening THAT policy to every
        // council role does not also widen who may bulk-export every member's photo and
        // credential data. This is defence-in-depth only: the procedures' own 51581 check is
        // what actually restricts this export to the National CouncilAdmin specifically. A
        // CouncilSecretary/CouncilAdmin seated on any OTHER council clears this policy and is
        // then rejected by the procedure itself (mapped to 403 below).
        g.MapGet("", Export).WithName("ExportIdCards")
            .RequireAuthorization(AuthorizationPolicies.NationalIdCardExport);

        // Second export type (client decision 2026-10-06) — a ZIP of rendered front/back
        // PNGs, one pair per member, instead of the spreadsheet+photos the Magicard
        // printer needs. Same policy, same bulk-issue-then-list shape, completely
        // separate column contract (DigitalIdCardRenderer.cs's own header).
        g.MapGet("/digital-id", ExportDigitalIdImages).WithName("ExportDigitalIdImages")
            .RequireAuthorization(AuthorizationPolicies.NationalIdCardExport);

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

    private static async Task<Results<FileContentHttpResult, ProblemHttpResult>> ExportDigitalIdImages(
        int? chapterId, IIdCardExportRepository repo, IFileStorage storage, IConfiguration config,
        ICurrentUser caller, ILoggerFactory loggerFactory, CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("Akrho.Api.Features.IdCardExport");
        try
        {
            // Same bulk-issue-first shape as Export above, same reasoning: makes
            // TokenSubject come back non-null for every row in practice.
            await repo.BulkIssueCredentialsAsync(caller.MemberId, chapterId, expiryDate: null, ct);
            var members = await repo.ListForDigitalIdExportAsync(caller.MemberId, chapterId, ct);

            var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
            var zipBytes = await BuildDigitalIdZipAsync(members, storage, webOrigin, logger, ct);

            var fileName = $"digital-ids-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip";
            return TypedResults.File(zipBytes, "application/zip", fileName);
        }
        catch (IdCardExportException ex)
        {
            return ex.Category switch
            {
                IdCardExportErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict)
            };
        }
    }

    private static async Task<byte[]> BuildDigitalIdZipAsync(
        IReadOnlyList<DigitalIdExportMemberRow> members, IFileStorage storage, string webOrigin,
        ILogger logger, CancellationToken ct)
    {
        using var zipStream = new MemoryStream();

        // Only members whose front/back actually got written below land here — a render
        // failure (caught further down) must never leave a dangling row in the workbook
        // pointing at a filename that doesn't exist in the ZIP.
        var rendered = new List<DigitalIdExportMemberRow>();

        using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var m in members)
            {
                ct.ThrowIfCancellationRequested();

                // One decode per source image per member, reused for both faces (the
                // chapter mark/photo are identical on whichever faces actually use them)
                // — never re-decoded per face.
                var photo = await TryDecodeAsync(storage, m.PhotoPath, logger, m.MemberNumber, "photo", ct);
                var chapterLogo = await TryDecodeAsync(storage, m.ChapterLogoPath, logger, m.MemberNumber, "chapter logo", ct);
                try
                {
                    // Blank (not a broken/placeholder link) for any row whose TokenSubject
                    // never came back — same posture as the Magicard export's own
                    // VerificationUrl construction.
                    var verificationUrl = m.TokenSubject is { } subject
                        ? $"{webOrigin}/verify/{subject:D}"
                        : "";

                    var fullName = string.Join(' ', new[] { m.FirstName, m.MiddleName, m.LastName }
                        .Where(s => !string.IsNullOrWhiteSpace(s)));

                    var input = new DigitalIdCardRenderer.CardInput(
                        m.GiftName, fullName, m.MemberNumber,
                        m.ChapterName, m.CityName,
                        m.BloodTypeName,
                        m.OfficePosition, m.OfficeBody,
                        m.IsPaid,
                        DateTime.UtcNow, // CredentialIssuedDateUtc isn't part of this list proc's own
                                         // column set (unlike the self-service credential screen, a
                                         // bulk export has no single "issued" moment worth exposing
                                         // per row) — the back face just shows today's export date.
                        verificationUrl,
                        photo, chapterLogo, m.MarkAccentHex);

                    var frontBytes = DigitalIdCardRenderer.RenderFront(input);
                    var backBytes = DigitalIdCardRenderer.RenderBack(input);

                    // FRONTIMAGE/BACKIMAGE folders (client decision 2026-10-07) — the two
                    // faces are segregated by folder rather than by filename suffix, so the
                    // filename itself is just the bare MemberNumber in each.
                    var frontEntry = archive.CreateEntry($"FRONTIMAGE/{m.MemberNumber}.png", CompressionLevel.Optimal);
                    await using (var frontStream = frontEntry.Open())
                        await frontStream.WriteAsync(frontBytes, ct);

                    var backEntry = archive.CreateEntry($"BACKIMAGE/{m.MemberNumber}.png", CompressionLevel.Optimal);
                    await using (var backStream = backEntry.Open())
                        await backStream.WriteAsync(backBytes, ct);

                    rendered.Add(m);
                }
                catch (Exception ex)
                {
                    // One member's card failing to render must never fail the whole bulk
                    // export — same "skip, don't fail" posture the Magicard export's own
                    // photo loop uses.
                    logger.LogWarning(ex,
                        "Digital ID export: card for {MemberNumber} could not be rendered — skipped, not failed",
                        m.MemberNumber);
                }
                finally
                {
                    photo?.Dispose();
                    chapterLogo?.Dispose();
                }
            }

            // Mail-merge workbook for the Magicard printer's own database (client decision
            // 2026-10-06, columns revised 2026-10-07) — the printer software maps each row
            // to its front/back image by MemberNumber, same key the FRONTIMAGE/BACKIMAGE
            // filenames themselves use.
            WriteDigitalIdWorkbookEntry(archive, rendered);
        }

        return zipStream.ToArray();
    }

    // Same NPOI/.xls reasoning as WriteWorkbookEntry above — this ships into the same
    // Magicard Enduro card-design software, which only reads the legacy binary format.
    // Column set and order are a client-specified contract (2026-10-06, revised 2026-10-07:
    // MemberId -> MemberNumber): FrontIdFileName/BackIdFileName must match the ZIP entry
    // paths this method's caller actually wrote byte-for-byte, FRONTIMAGE/BACKIMAGE prefix
    // included. Do not reorder, rename, or add columns without checking the Magicard
    // template first.
    private static void WriteDigitalIdWorkbookEntry(ZipArchive archive, IReadOnlyList<DigitalIdExportMemberRow> members)
    {
        using var workbook = new HSSFWorkbook();
        var sheet = workbook.CreateSheet("Members");

        string[] headers = ["MemberNumber", "FirstName", "LastName", "FrontIdFileName", "BackIdFileName"];
        var headerRow = sheet.CreateRow(0);
        for (var col = 0; col < headers.Length; col++)
            headerRow.CreateCell(col).SetCellValue(headers[col]);

        var rowIndex = 1;
        foreach (var m in members)
        {
            var row = sheet.CreateRow(rowIndex);
            row.CreateCell(0).SetCellValue(m.MemberNumber);
            row.CreateCell(1).SetCellValue(m.FirstName);
            row.CreateCell(2).SetCellValue(m.LastName);
            row.CreateCell(3).SetCellValue($"FRONTIMAGE/{m.MemberNumber}.png");
            row.CreateCell(4).SetCellValue($"BACKIMAGE/{m.MemberNumber}.png");
            rowIndex++;
        }

        for (var col = 0; col < headers.Length; col++)
            sheet.AutoSizeColumn(col);

        var entry = archive.CreateEntry("members.xls", CompressionLevel.Optimal);
        using var entryStream = entry.Open();
        workbook.Write(entryStream, leaveOpen: true);
    }

    private static async Task<SKBitmap?> TryDecodeAsync(
        IFileStorage storage, string? path, ILogger logger, string memberNumber, string kind, CancellationToken ct)
    {
        if (path is null) return null;

        Stream source;
        try
        {
            source = await storage.OpenReadAsync(path, ct);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex,
                "Digital ID export: {Kind} file for {MemberNumber} is missing on this environment's disk — skipped, not failed",
                kind, memberNumber);
            return null;
        }

        await using (source)
        {
            try
            {
                return SKBitmap.Decode(source);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Digital ID export: {Kind} file for {MemberNumber} could not be decoded — skipped, not failed",
                    kind, memberNumber);
                return null;
            }
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
    // do not reorder or rename them without checking that template first — which is
    // also why the 5 columns added 2026-10-09 (client decision: DateSurvive, chapter
    // Municipality/Province/Region, PaymentStatus) are APPENDED at the end rather than
    // inserted among the originals, so no already-configured mail-merge field shifts
    // index. GiftName was already present before that change (column 4) — not moved.
    private static void WriteWorkbookEntry(
        ZipArchive archive, IReadOnlyList<IdCardExportMemberRow> members, string webOrigin)
    {
        using var workbook = new HSSFWorkbook();
        var sheet = workbook.CreateSheet("Members");

        string[] headers =
        [
            "MemberNumber", "FirstName", "MiddleName", "LastName", "GiftName", "BloodTypeName",
            "ChapterName", "ChapterCode", "StatusName", "PhotoFileName", "VerificationUrl",
            "DateSurvive", "Municipality", "Province", "Region", "PaymentStatus"
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
            row.CreateCell(11).SetCellValue(m.DateSurvive?.ToString("yyyy-MM-dd") ?? string.Empty);
            row.CreateCell(12).SetCellValue(m.CityName ?? string.Empty);
            row.CreateCell(13).SetCellValue(m.ProvinceName ?? string.Empty);
            row.CreateCell(14).SetCellValue(m.RegionName ?? string.Empty);
            row.CreateCell(15).SetCellValue(m.PaymentStatus);
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
