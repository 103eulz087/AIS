/* Chapter mark, image slice (added 2026-09-29). Claims a staged upload as the caller's
   OWN chapter's logo — same "stage and claim in one call" shape as usp_Member_SetPhoto,
   for the same reason: a Chapter row already exists the moment its President is signed
   in, so there is no "doesn't exist yet" window an expense-style two-step split would be
   protecting against.

   PRESIDENT ONLY. Per this codebase's own officer-seeding convention
   (db/seed/01_reference.sql), the 'ChapterAdmin' role IS the President's office —
   nothing else maps to it — so this reuses that role bar directly rather than inventing
   a separate "President" claim (client decision 2026-09-29: gate on ChapterAdmin, same as
   every other President-only action in this codebase — usp_Member_UpdateByOfficer,
   usp_ChapterRegistration_SubmitTurnover, etc.).

   No approval step. Client decision 2026-09-29: goes live immediately on every member's
   Digital ID the moment this call succeeds — NOT the council-review flow
   RegisterChapter.tsx's own old placeholder copy once hinted at. Do not add a pending/
   approval state here without a fresh, equally explicit decision.

   ANY IMAGE FORMAT (relaxed 2026-09-30 — originally PNG-only; see
   MembersEndpoints.StageChapterLogo's own allow-list for the current check). Because the
   format is no longer fixed, LogoContentType is captured here from the staged row's own
   ContentType and stored alongside LogoPath — same PhotoPath/PhotoContentType pairing
   dbo.Member already uses — so GetOwnChapterLogo can serve back whatever was actually
   uploaded instead of assuming image/png. Nothing in this pipeline re-encodes or
   flattens the bytes (IFileStorage is a byte-for-byte store; the only JPEG re-encode in
   this codebase is IdCardExportEndpoints' own bulk-export path, never this one) — a
   format with an alpha channel (PNG, WEBP, GIF) still comes out borderless; a format
   without one (JPEG) shows whatever background the source file itself had baked in.

   Ownership check: identical shape to usp_Member_SetPhoto's own — the staged row must
   have been uploaded BY THIS SAME MEMBER and must be unconsumed. Both conditions collapse
   into a single "not found" so a probe learns nothing about ids it does not own. */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_SetLogo
    @RequestingMemberId  INT,
    @AttachmentStagingId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0;

    IF @ChapterId IS NULL
        THROW 51920, 'A chapter logo can only be set by a chapter-homed member.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Chapter' AND mr.ScopeId = @ChapterId
          AND r.RoleName = 'ChapterAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51921, 'Only your chapter''s own President may set the chapter logo.', 1;

    DECLARE @UploadedBy INT, @FilePath NVARCHAR(400), @ContentType NVARCHAR(100), @ConsumedDate DATETIME2;
    SELECT  @UploadedBy   = UploadedBy,
            @FilePath     = FilePath,
            @ContentType  = ContentType,
            @ConsumedDate = ConsumedDate
    FROM    dbo.AttachmentStaging
    WHERE   AttachmentStagingId = @AttachmentStagingId;

    IF @UploadedBy IS NULL OR @UploadedBy <> @RequestingMemberId OR @ConsumedDate IS NOT NULL
        THROW 51922, 'That upload was not found, or has already been used.', 1;

    BEGIN TRAN;
        UPDATE dbo.Chapter
           SET LogoPath = @FilePath, LogoContentType = @ContentType
         WHERE ChapterId = @ChapterId;

        UPDATE dbo.AttachmentStaging
           SET ConsumedDate = SYSUTCDATETIME()
         WHERE AttachmentStagingId = @AttachmentStagingId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Chapter', CAST(@ChapterId AS NVARCHAR(40)), 'SetLogo',
                CONCAT(N'{"AttachmentStagingId":', @AttachmentStagingId, N'}'), @RequestingMemberId);
    COMMIT;

    SELECT @FilePath AS LogoPath;
END
GO
