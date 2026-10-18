/* Chapter mark, image slice — client decision 2026-09-30: chapter logo uploads are no
   longer PNG-only (relaxed from the original 2026-09-29 design, which restricted to PNG
   specifically to guarantee alpha-channel transparency for a borderless look). Any image
   format is now accepted, so — same reasoning as dbo.Member.PhotoPath/PhotoContentType —
   the actual uploaded content type must be stored and served back as-is; it can no
   longer be safely hardcoded to 'image/png' at the serving endpoint. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'LogoContentType')
    ALTER TABLE dbo.Chapter ADD LogoContentType NVARCHAR(100) NULL;
GO
