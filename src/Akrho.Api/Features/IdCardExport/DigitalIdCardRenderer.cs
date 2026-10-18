using QRCoder;
using SkiaSharp;

namespace Akrho.Api.Features.IdCardExport;

/// <summary>
/// Paints the Digital ID card's front and back faces as static PNGs, for the bulk
/// "Export Digital ID images" download (client decision 2026-10-06 — a second export
/// type alongside the existing Magicard spreadsheet+photos export, see
/// IdCardExportEndpoints.MapIdCardExport's own header for how the two are told apart).
///
/// THIS IS A SECOND IMPLEMENTATION OF src/web/src/ais/screens/DigitalId.tsx's OWN VISUAL
/// DESIGN, redrawn here with SkiaSharp instead of React/CSS — a deliberate trade-off
/// (client decision 2026-10-06, chosen over a headless-browser screenshot specifically to
/// avoid reintroducing the multi-hundred-MB Chromium deployment bloat CLAUDE.md's own
/// publish-size fix just removed). Colours, fonts and layout proportions below are kept
/// in sync BY HAND with DigitalId.tsx/shared/idCardTheme.tsx — there is no shared source
/// of truth between the two. If that screen's visual design changes again, this file
/// needs the matching change too, or the exported image quietly goes stale. Pixel-perfect
/// parity with the live card was explicitly NOT the goal; faithful colours/content/layout
/// at a fixed export resolution was.
///
/// SIZE AND CORNERS (client decision 2026-10-07): the export must be a real CR80-class
/// card — 3.37in x 2.127in, square corners throughout — not an arbitrary mockup-shaped
/// image. That is a different aspect ratio (1.584:1) from the on-screen design this file
/// mirrors (358x284 "css px", 1.261:1), so the whole design is composed in that original
/// 358x284 coordinate space exactly as before, and a single NON-UNIFORM canvas transform
/// (ScaleX, ScaleY — see RenderFront/RenderBack) stretches the entire composition onto the
/// real card dimensions in one step, rather than hand-redesigning every element's position
/// for a new aspect ratio. Trade-off: everything is ~26% wider relative to its own height
/// than it looks on screen (ScaleX/ScaleY ≈ 1.257) — acceptable for a printed card, but if
/// that visible stretch ever needs removing, the fix is a real layout redesign, not a
/// transform tweak. Two elements are deliberately exempted from the stretch because
/// distortion there is a functional problem, not just cosmetic: the QR code (non-square
/// modules risk scan reliability) and the national seal (a circle, not a "corner," should
/// stay circular) — both reset the canvas transform to draw themselves in true, undistorted
/// pixel space. Every ROUNDED corner elsewhere (card shell, photo frame, chapter mark,
/// role tag, NOT-YET-PAID stamp) is now a plain square corner.
/// </summary>
public static class DigitalIdCardRenderer
{
    // The design is composed in this fixed "css px" coordinate space — unchanged from
    // before 2026-10-07 — and mapped onto the real card size by ScaleX/ScaleY below. Do
    // not reintroduce per-coordinate "* Scale" multiplication anywhere in this file; the
    // single canvas.Scale(ScaleX, ScaleY) call in RenderFront/RenderBack is the only place
    // the css-px -> pixel conversion happens (a prior per-coordinate scheme caused a real
    // double-scaling bug when combined with a canvas transform — never combine the two).
    private const float BaseW = 358f;
    private const float BaseH = 284f;

    // 3.37in x 2.127in at 300 DPI — matches common card-printer native resolution (incl.
    // the Magicard Enduro this export feeds), so there is no quality to gain from a higher
    // DPI here. 2.127in * 300 = 638.1, rounded to 638.
    public const int WidthPx = 1011;
    public const int HeightPx = 638;
    private const float ScaleX = WidthPx / BaseW;
    private const float ScaleY = HeightPx / BaseH;

    // ID_CARD palette — mirrors shared/idCardTheme.tsx's own ID_CARD object exactly.
    private static readonly SKColor BgTop = new(0x13, 0x1C, 0x17);
    private static readonly SKColor BgMid = new(0x0B, 0x12, 0x0E);
    private static readonly SKColor BgBottom = new(0x05, 0x08, 0x05);
    private static readonly SKColor CardBorderColor = new(46, 216, 160, 56); // rgba(46,216,160,.22)
    private static readonly SKColor Accent = new(0x2E, 0xD8, 0xA0);
    private static readonly SKColor AccentDim = new(0x1B, 0x7A, 0x5C);
    private static readonly SKColor AccentSoft = new(0xBF, 0xF3, 0xDE);
    private static readonly SKColor White = SKColors.White;
    private static readonly SKColor Muted = new(0x8F, 0xA7, 0x9C);
    private static readonly SKColor FooterBgLeft = new(0x12, 0x35, 0x27);
    private static readonly SKColor FooterBgRight = new(0x08, 0x15, 0x0F);
    private static readonly SKColor NotPaidRed = new(224, 82, 63, 199); // rgba(224,82,63,.78)

    // MEMBER_THEME / OFFICER_THEME — mirrors DigitalId.tsx's own two constants (which
    // themselves read var(--id-member)/var(--id-officer) from tokens.css) exactly.
    private static readonly (SKColor Accent, SKColor Soft, SKColor StripBg) MemberTheme =
        (new SKColor(0x2F, 0xA5, 0x62), new SKColor(0xBF, 0xE8, 0xCF), new SKColor(47, 165, 98, 41));
    private static readonly (SKColor Accent, SKColor Soft, SKColor StripBg) OfficerTheme =
        (new SKColor(0xD3, 0x30, 0x2F), new SKColor(0xF5, 0xC6, 0xC4), new SKColor(211, 48, 47, 41));

    private static readonly string AssetsDir = Path.Combine(AppContext.BaseDirectory, "Assets");

    private static readonly Lazy<SKTypeface> DisplayBold = new(() =>
        SKTypeface.FromFile(Path.Combine(AssetsDir, "Fonts", "BarlowCondensed-Bold.ttf")) ?? SKTypeface.Default);
    private static readonly Lazy<SKTypeface> Body = new(() =>
        SKTypeface.FromFile(Path.Combine(AssetsDir, "Fonts", "IBMPlexSans-Variable.ttf")) ?? SKTypeface.Default);
    private static readonly Lazy<SKImage?> NationalSeal = new(() =>
    {
        var path = Path.Combine(AssetsDir, "Images", "national-seal.jpg");
        return File.Exists(path) ? SKImage.FromEncodedData(path) : null;
    });

    /// <summary>Everything one card face needs. Photo/ChapterLogo are already-decoded
    /// bitmaps (or null) — decoding/EXIF-correction happens once in the caller, not twice
    /// per member for front+back.</summary>
    public sealed record CardInput(
        string GiftName, string FullName, string MemberNumber,
        string ChapterName, string? CityName,
        string? BloodTypeName,
        string? OfficePosition, string? OfficeBody,
        bool IsPaid,
        DateTime CredentialIssuedDateUtc,
        string VerificationUrl,
        SKBitmap? Photo, SKBitmap? ChapterLogo, string? MarkAccentHex);

    public static byte[] RenderFront(CardInput c)
    {
        using var surface = SKSurface.Create(new SKImageInfo(WidthPx, HeightPx, SKColorType.Rgba8888, SKAlphaType.Premul));
        var canvas = surface.Canvas;
        canvas.Scale(ScaleX, ScaleY);
        var theme = string.IsNullOrEmpty(c.OfficePosition) ? MemberTheme : OfficerTheme;

        DrawCardShell(canvas, theme.Accent);

        float x = 16, y = 16;
        var wordmarkWidth = DrawHeader(canvas, "ALPHA KAPPA RHO", "INFORMATION SYSTEM", "MEMBER IDENTIFICATION CARD", x, y);
        y += 40 + 10; // header row height + marginTop before divider
        DrawDivider(canvas, x, y, BaseW - 32);
        y += 1 + 14; // divider + marginTop before photo row

        var rowTop = y;
        DrawPhoto(canvas, c.Photo, c.GiftName, x, rowTop, theme.Accent);

        var columnX = x + 66 + 14;
        var columnWidth = BaseW - 32 - 66 - 14 - 14 - 40;
        var cy = rowTop;
        cy += DrawBodyText(canvas, c.FullName, columnX, cy, columnWidth, 13, White, bold: true);
        cy += 6;
        cy += DrawMeta(canvas, "Chapter", c.ChapterName, columnX, cy, columnWidth, right: false);
        var memberNoWidth = columnWidth * 0.6f;
        var bloodWidth = columnWidth - memberNoWidth;
        var metaRowY = cy + 8;
        var memberNoHeight = DrawMeta(canvas, "Member no.", c.MemberNumber, columnX, metaRowY, memberNoWidth, right: false);
        if (!string.IsNullOrEmpty(c.BloodTypeName))
            DrawMeta(canvas, "Blood", c.BloodTypeName!, columnX + memberNoWidth, metaRowY, bloodWidth, right: true);
        cy = metaRowY + memberNoHeight;

        var markX = columnX + columnWidth + 14;
        DrawChapterMark(canvas, c.ChapterLogo, c.ChapterName, c.MarkAccentHex, markX, rowTop);

        var photoRowBottom = rowTop + 82; // the photo (66x82) is always the tallest item in this row
        var roleTagY = photoRowBottom + 10;
        var roleTagWidth = DrawRoleTag(canvas, c.OfficePosition, theme.Accent, x, roleTagY, BaseW - 32);

        DrawFrontFooter(canvas, c, theme, 0, BaseH, BaseW);

        if (!c.IsPaid) DrawNotPaidWatermark(canvas, BaseW, BaseH);

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    public static byte[] RenderBack(CardInput c)
    {
        using var surface = SKSurface.Create(new SKImageInfo(WidthPx, HeightPx, SKColorType.Rgba8888, SKAlphaType.Premul));
        var canvas = surface.Canvas;
        canvas.Scale(ScaleX, ScaleY);
        var theme = string.IsNullOrEmpty(c.OfficePosition) ? MemberTheme : OfficerTheme;

        DrawCardShell(canvas, theme.Accent);

        float x = 16, y = 16;
        DrawHeader(canvas, "VERIFICATION", "ALPHA KAPPA RHO INFORMATION SYSTEM", null, x, y);
        y += 40 + 10;
        DrawDivider(canvas, x, y, BaseW - 32);
        y += 1 + 14;

        var textWidth = BaseW - 32 - 88 - 14;
        var ty = y;
        ty += DrawBodyText(canvas, "Scan to verify this card.", x, ty, textWidth, 13, White, bold: true);
        ty += 6;
        ty += DrawWrappedBodyText(canvas, "Opens a public page showing photo, name, chapter and current status. No personal data is stored in the code.", x, ty, textWidth, 11, Muted);
        ty += 12;
        ty += DrawBodyText(canvas, "IF FOUND", x, ty, textWidth, 10, theme.Accent, bold: true, uppercase: true);
        ty += 4;
        DrawWrappedBodyText(canvas, "Return to the chapter secretary or any AKRHO council office.", x, ty, textWidth, 11, Muted);

        DrawQrCode(canvas, c.VerificationUrl, x + textWidth + 14, y, 88);

        DrawBackFooter(canvas, c, theme, 0, BaseH, BaseW);

        if (!c.IsPaid) DrawNotPaidWatermark(canvas, BaseW, BaseH);

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    // ------------------------------------------------------------------ shell/chrome

    private static void DrawCardShell(SKCanvas canvas, SKColor accentBorder)
    {
        var rect = new SKRect(0, 0, BaseW, BaseH);

        using (var bgPaint = new SKPaint { IsAntialias = true })
        {
            bgPaint.Shader = SKShader.CreateLinearGradient(
                new SKPoint(0, 0), new SKPoint(BaseW * 0.35f, BaseH),
                [BgTop, BgMid, BgBottom], [0f, 0.55f, 1f], SKShaderTileMode.Clamp);
            canvas.DrawRect(rect, bgPaint);
        }

        using var borderPaint = new SKPaint
        {
            IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 2, Color = accentBorder,
        };
        var inset = SKRect.Inflate(rect, -1, -1); // half the stroke width, so the stroke sits fully inside the card
        canvas.DrawRect(inset, borderPaint);
    }

    /// <summary>The AIS wordmark + up-to-3-line text block + (for the caller to draw
    /// separately) the national seal slot. Returns the wordmark's own measured width, in
    /// case a caller ever needs it — unused today, kept for parity with how the live
    /// component's layout is computed (flex, not hardcoded offsets).</summary>
    private static float DrawHeader(SKCanvas canvas, string line1, string? line2, string? line3, float x, float y)
    {
        using var wordmarkFont = new SKFont(DisplayBold.Value, 26);
        using var wordmarkPaint = new SKPaint { IsAntialias = true, Color = Accent };
        var wordmarkWidth = wordmarkFont.MeasureText("AIS", wordmarkPaint);
        canvas.DrawText("AIS", x, y + 20, SKTextAlign.Left, wordmarkFont, wordmarkPaint);

        var textX = x + wordmarkWidth + 10;
        var ty = y + 2;
        ty += DrawBodyText(canvas, line1, textX, ty, BaseW - textX - 16 - 46, 13, White, bold: true, display: true);
        if (line2 is not null)
        {
            ty += 1;
            ty += DrawBodyText(canvas, line2, textX, ty, BaseW - textX - 16 - 46, 10, Accent);
        }
        if (line3 is not null)
        {
            ty += 1;
            DrawBodyText(canvas, line3, textX, ty, BaseW - textX - 16 - 46, 8.5f, Muted);
        }

        var sealRect = new SKRect(BaseW - 16 - 40, y, BaseW - 16, y + 40);
        DrawCircularImage(canvas, NationalSeal.Value, sealRect, Accent, scaleOverfill: 1.12f);

        return wordmarkWidth;
    }

    private static void DrawDivider(SKCanvas canvas, float x, float y, float width)
    {
        using var paint = new SKPaint { Color = CardBorderColor };
        canvas.DrawRect(x, y, width, 1, paint);
    }

    // ------------------------------------------------------------------ front-face pieces

    private static void DrawPhoto(SKCanvas canvas, SKBitmap? photo, string giftName, float x, float y, SKColor accent)
    {
        var rect = new SKRect(x, y, x + 66, y + 82);

        if (photo is not null)
        {
            canvas.Save();
            canvas.ClipRect(rect, antialias: true); // square corners — plain clip, not rounded
            DrawImageCover(canvas, photo, rect);
            canvas.Restore();
        }
        else
        {
            using var bg = new SKPaint { IsAntialias = true, Color = new SKColor(0x15, 0x20, 0x19) };
            canvas.DrawRect(rect, bg);

            var initials = (string.IsNullOrEmpty(giftName) ? "—" : giftName[..Math.Min(2, giftName.Length)]).ToUpperInvariant();
            using var font = new SKFont(DisplayBold.Value, 22);
            using var paint = new SKPaint { IsAntialias = true, Color = accent };
            var tw = font.MeasureText(initials, paint);
            canvas.DrawText(initials, rect.MidX - tw / 2, rect.MidY + 8, SKTextAlign.Left, font, paint);
        }

        using var border = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 1.5f, Color = accent };
        canvas.DrawRect(rect, border);
    }

    /// <summary>Label-above-value, the same shape DigitalId.tsx's own Meta() component
    /// uses. Returns the total height consumed.</summary>
    private static float DrawMeta(SKCanvas canvas, string label, string value, float x, float y, float width, bool right)
    {
        var align = right ? SKTextAlign.Right : SKTextAlign.Left;
        var drawX = right ? x + width : x;

        using var labelFont = new SKFont(DisplayBold.Value, 9.5f);
        using var labelPaint = new SKPaint { IsAntialias = true, Color = Muted };
        canvas.DrawText(label.ToUpperInvariant(), drawX, y + 8, align, labelFont, labelPaint);

        using var valueFont = new SKFont(Body.Value, 13) { Embolden = true };
        using var valuePaint = new SKPaint { IsAntialias = true, Color = White };
        var truncated = Truncate(value, valueFont, valuePaint, width);
        canvas.DrawText(truncated, drawX, y + 24, align, valueFont, valuePaint);

        return 26;
    }

    private static void DrawChapterMark(SKCanvas canvas, SKBitmap? logo, string chapterName, string? markAccentHex, float x, float y)
    {
        const float size = 40;
        if (logo is not null)
        {
            var dest = FitContain(logo, new SKRect(x, y, x + size, y + size));
            DrawImageContain(canvas, logo, dest);
            return;
        }

        var accent = ParseHexOrDefault(markAccentHex, AccentDim);
        using var bg = new SKPaint { IsAntialias = true, Color = accent };
        canvas.DrawRect(new SKRect(x, y, x + size, y + size), bg);

        var initials = ChapterInitials(chapterName);
        using var font = new SKFont(DisplayBold.Value, size * 0.4f);
        using var paint = new SKPaint { IsAntialias = true, Color = White };
        var tw = font.MeasureText(initials, paint);
        canvas.DrawText(initials, x + size / 2 - tw / 2, y + size / 2 + size * 0.14f,
            SKTextAlign.Left, font, paint);
    }

    private static float DrawRoleTag(SKCanvas canvas, string? officePosition, SKColor accent, float x, float y, float containerWidth)
    {
        var label = string.IsNullOrEmpty(officePosition) ? "MEMBER" : "OFFICER";
        using var font = new SKFont(DisplayBold.Value, 10);
        using var textPaint = new SKPaint { IsAntialias = true, Color = White };
        var tw = font.MeasureText(label, textPaint);
        var pillWidth = tw + 16; // "3px 8px" padding each side
        var pillX = x + containerWidth - pillWidth;

        using var bg = new SKPaint { IsAntialias = true, Color = accent };
        canvas.DrawRect(new SKRect(pillX, y, pillX + pillWidth, y + 16), bg);
        canvas.DrawText(label, pillX + 8, y + 12, SKTextAlign.Left, font, textPaint);

        return pillWidth;
    }

    private static void DrawFrontFooter(
        SKCanvas canvas, CardInput c, (SKColor Accent, SKColor Soft, SKColor StripBg) theme,
        float x, float bottomY, float width)
    {
        const float height = 40;
        var top = bottomY - height;
        DrawFooterBar(canvas, x, top, width, height, theme.Accent, theme.StripBg);

        var padX = x + 16;
        using var nameFont = new SKFont(DisplayBold.Value, 18);
        using var namePaint = new SKPaint { IsAntialias = true, Color = White };
        var name = Truncate(c.ChapterName, nameFont, namePaint, width * 0.55f);
        canvas.DrawText(name, padX, top + 20, SKTextAlign.Left, nameFont, namePaint);

        if (c.CityName is { Length: > 0 } city)
        {
            using var cityFont = new SKFont(Body.Value, 10.5f);
            using var cityPaint = new SKPaint { IsAntialias = true, Color = AccentSoft };
            var truncated = Truncate(city, cityFont, cityPaint, width * 0.55f);
            canvas.DrawText(truncated, padX, top + 32, SKTextAlign.Left, cityFont, cityPaint);
        }

        if (!string.IsNullOrEmpty(c.OfficePosition))
        {
            var rightX = x + width - 16;
            using var posFont = new SKFont(DisplayBold.Value, 13);
            using var posPaint = new SKPaint { IsAntialias = true, Color = theme.Accent };
            var pos = c.OfficePosition!.ToUpperInvariant();
            canvas.DrawText(pos, rightX, top + 18, SKTextAlign.Right, posFont, posPaint);

            if (!string.IsNullOrEmpty(c.OfficeBody))
            {
                using var bodyFont = new SKFont(Body.Value, 10);
                using var bodyPaint = new SKPaint { IsAntialias = true, Color = theme.Soft };
                canvas.DrawText(c.OfficeBody!, rightX, top + 32, SKTextAlign.Right, bodyFont, bodyPaint);
            }
        }
    }

    private static void DrawBackFooter(
        SKCanvas canvas, CardInput c, (SKColor Accent, SKColor Soft, SKColor StripBg) theme,
        float x, float bottomY, float width)
    {
        const float height = 24;
        var top = bottomY - height;
        DrawFooterBar(canvas, x, top, width, height, theme.Accent, theme.StripBg);

        using var font = new SKFont(Body.Value, 10);
        using var paint = new SKPaint { IsAntialias = true, Color = AccentSoft };
        canvas.DrawText($"Issued {c.CredentialIssuedDateUtc:MMM d, yyyy}", x + 16, top + 15,
            SKTextAlign.Left, font, paint);
        canvas.DrawText(c.GiftName, x + width - 16, top + 15, SKTextAlign.Right, font, paint);
    }

    private static void DrawFooterBar(SKCanvas canvas, float x, float y, float width, float height, SKColor borderColor, SKColor tint)
    {
        using var bg = new SKPaint
        {
            Shader = SKShader.CreateLinearGradient(
                new SKPoint(x, y), new SKPoint(x + width, y),
                [FooterBgLeft, FooterBgRight], [0f, 1f], SKShaderTileMode.Clamp),
        };
        canvas.DrawRect(x, y, width, height, bg);

        using var tintPaint = new SKPaint { Color = tint };
        canvas.DrawRect(x, y, width, height, tintPaint);

        using var border = new SKPaint { Color = borderColor, StrokeWidth = 1 };
        canvas.DrawLine(x, y, x + width, y, border);
    }

    private static void DrawQrCode(SKCanvas canvas, string verificationUrl, float x, float y, float size)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(verificationUrl, QRCodeGenerator.ECCLevel.Q);
        var pngQr = new PngByteQRCode(data);
        var qrBytes = pngQr.GetGraphic(20);
        using var qrImage = SKBitmap.Decode(qrBytes);

        // Drawn in real, undistorted pixel space — not under the card's ambient
        // ScaleX/ScaleY — because a QR code's modules must stay square for reliable
        // scanning (2026-10-07's header comment explains why the card as a whole is
        // allowed to stretch but this one element is not). Sized by the SMALLER of the
        // two axis scales so it still fits entirely inside the (size x size) box this
        // method was originally asked to fill.
        var pixelX = x * ScaleX;
        var pixelY = y * ScaleY;
        var pixelSize = size * Math.Min(ScaleX, ScaleY);
        var dest = new SKRect(pixelX, pixelY, pixelX + pixelSize, pixelY + pixelSize);

        canvas.Save();
        canvas.ResetMatrix();
        canvas.DrawBitmap(qrImage, dest, new SKSamplingOptions(SKFilterMode.Nearest, SKMipmapMode.None), paint: null);
        canvas.Restore();
    }

    private static void DrawNotPaidWatermark(SKCanvas canvas, float width, float height)
    {
        canvas.Save();
        canvas.Translate(width / 2, height / 2);
        canvas.RotateDegrees(-16);

        using var font = new SKFont(DisplayBold.Value, 22) { Embolden = true };
        using var textPaint = new SKPaint { IsAntialias = true, Color = NotPaidRed };
        const string label = "NOT YET PAID";
        var tw = font.MeasureText(label, textPaint);

        using var borderPaint = new SKPaint
        {
            IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 2.5f, Color = NotPaidRed,
        };
        const float pad = 14f;
        canvas.DrawRect(new SKRect(-tw / 2 - pad, -20, tw / 2 + pad, 20), borderPaint);
        canvas.DrawText(label, -tw / 2, 8, SKTextAlign.Left, font, textPaint);

        canvas.Restore();
    }

    // ------------------------------------------------------------------ generic text/image helpers

    private static float DrawBodyText(
        SKCanvas canvas, string text, float x, float y, float width, float fontSize, SKColor color,
        bool bold = false, bool uppercase = false, bool display = false)
    {
        var typeface = display ? DisplayBold.Value : (bold ? Body.Value : Body.Value);
        using var font = new SKFont(typeface, fontSize) { Embolden = bold && !display };
        using var paint = new SKPaint { IsAntialias = true, Color = color };
        var rendered = uppercase ? text.ToUpperInvariant() : text;
        var truncated = Truncate(rendered, font, paint, width);
        canvas.DrawText(truncated, x, y + fontSize * 0.8f, SKTextAlign.Left, font, paint);
        return fontSize * 1.2f;
    }

    private static float DrawWrappedBodyText(SKCanvas canvas, string text, float x, float y, float width, float fontSize, SKColor color)
    {
        using var font = new SKFont(Body.Value, fontSize);
        using var paint = new SKPaint { IsAntialias = true, Color = color };
        var lines = WrapText(text, font, paint, width);
        var lineHeight = fontSize * 1.5f;
        var cy = y;
        foreach (var line in lines)
        {
            canvas.DrawText(line, x, cy + fontSize * 0.8f, SKTextAlign.Left, font, paint);
            cy += lineHeight;
        }
        return lines.Count * lineHeight;
    }

    private static List<string> WrapText(string text, SKFont font, SKPaint paint, float maxWidthPx)
    {
        var words = text.Split(' ');
        var lines = new List<string>();
        var current = "";
        foreach (var word in words)
        {
            var candidate = current.Length == 0 ? word : $"{current} {word}";
            if (font.MeasureText(candidate, paint) > maxWidthPx && current.Length > 0)
            {
                lines.Add(current);
                current = word;
            }
            else
            {
                current = candidate;
            }
        }
        if (current.Length > 0) lines.Add(current);
        return lines;
    }

    private static string Truncate(string text, SKFont font, SKPaint paint, float maxWidthPx)
    {
        if (font.MeasureText(text, paint) <= maxWidthPx) return text;
        var truncated = text;
        while (truncated.Length > 1 && font.MeasureText(truncated + "…", paint) > maxWidthPx)
            truncated = truncated[..^1];
        return truncated + "…";
    }

    private static void DrawCircularImage(SKCanvas canvas, SKImage? image, SKRect destCssRect, SKColor borderColor, float scaleOverfill = 1f)
    {
        // Drawn in real, undistorted pixel space — not under the card's ambient
        // ScaleX/ScaleY — so the national seal stays a true circle rather than becoming
        // an ellipse (same reasoning as DrawQrCode's own comment). Sized by the SMALLER
        // of the two axis scales so it still fits entirely inside the originally
        // requested box.
        var pixelLeft = destCssRect.Left * ScaleX;
        var pixelTop = destCssRect.Top * ScaleY;
        var pixelSize = Math.Min(destCssRect.Width * ScaleX, destCssRect.Height * ScaleY);
        var dest = new SKRect(pixelLeft, pixelTop, pixelLeft + pixelSize, pixelTop + pixelSize);
        var radius = dest.Width / 2;

        canvas.Save();
        canvas.ResetMatrix();

        canvas.Save();
        // A "rounded rect" whose radius is half its own width/height IS a circle — avoids
        // SKPath.AddCircle, obsolete in this SkiaSharp version in favour of SKPathBuilder.
        canvas.ClipRoundRect(new SKRoundRect(dest, radius), antialias: true);
        if (image is not null)
        {
            var overfilled = SKRect.Inflate(dest, dest.Width * (scaleOverfill - 1) / 2, dest.Height * (scaleOverfill - 1) / 2);
            DrawImageCoverRaw(canvas, image, overfilled);
        }
        else
        {
            using var fallback = new SKPaint { IsAntialias = true, Color = AccentDim };
            canvas.DrawRect(dest, fallback);
        }
        canvas.Restore(); // pops the clip, keeps the reset (identity) matrix

        using var border = new SKPaint { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 1.5f, Color = borderColor };
        canvas.DrawCircle(dest.MidX, dest.MidY, radius - 1, border);

        canvas.Restore(); // restores the card's own ambient ScaleX/ScaleY transform
    }

    private static void DrawImageCover(SKCanvas canvas, SKBitmap bitmap, SKRect destCssRect)
    {
        using var image = SKImage.FromBitmap(bitmap);
        DrawImageCoverRaw(canvas, image, destCssRect);
    }

    private static void DrawImageCoverRaw(SKCanvas canvas, SKImage image, SKRect dest)
    {
        var srcAspect = (float)image.Width / image.Height;
        var destAspect = dest.Width / dest.Height;
        SKRect src;
        if (srcAspect > destAspect)
        {
            var cropWidth = image.Height * destAspect;
            var offsetX = (image.Width - cropWidth) / 2;
            src = new SKRect(offsetX, 0, offsetX + cropWidth, image.Height);
        }
        else
        {
            var cropHeight = image.Width / destAspect;
            var offsetY = (image.Height - cropHeight) / 2;
            src = new SKRect(0, offsetY, image.Width, offsetY + cropHeight);
        }
        using var paint = new SKPaint { IsAntialias = true };
        canvas.DrawImage(image, src, dest, SKSamplingOptions.Default, paint);
    }

    private static SKRect FitContain(SKBitmap bitmap, SKRect boundsCss)
    {
        var srcAspect = (float)bitmap.Width / bitmap.Height;
        var boundsAspect = boundsCss.Width / boundsCss.Height;
        float w, h;
        if (srcAspect > boundsAspect) { w = boundsCss.Width; h = w / srcAspect; }
        else { h = boundsCss.Height; w = h * srcAspect; }
        var cx = boundsCss.MidX; var cy = boundsCss.MidY;
        return new SKRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    }

    private static void DrawImageContain(SKCanvas canvas, SKBitmap bitmap, SKRect destCss)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var paint = new SKPaint { IsAntialias = true };
        canvas.DrawImage(image, destCss, SKSamplingOptions.Default, paint);
    }

    private static SKColor ParseHexOrDefault(string? hex, SKColor fallback)
    {
        if (string.IsNullOrEmpty(hex) || !hex.StartsWith('#') || hex.Length != 7) return fallback;
        return SKColor.TryParse(hex, out var parsed) ? parsed : fallback;
    }

    /// <summary>Mirrors ChapterMonogram.tsx's own chapterInitials() exactly — two
    /// distinct chapter names must never collapse to the same fallback monogram text any
    /// differently here than they would on the live screen.</summary>
    private static string ChapterInitials(string chapterName)
    {
        var words = chapterName.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0) return "?";
        if (words.Length == 1) return words[0][..Math.Min(2, words[0].Length)].ToUpperInvariant();
        return $"{words[0][0]}{words[1][0]}".ToUpperInvariant();
    }
}
