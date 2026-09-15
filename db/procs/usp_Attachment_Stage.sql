/* Stages an uploaded file for later, atomic consumption by usp_Expense_Create (the only
   consumer today — a donation records no attachments per docs §4.6). The upload endpoint
   (POST /api/attachments) has already written the file to disk via IFileStorage and validated
   its size/MIME type; this proc only records the resulting row. ChapterId and UploadedBy come
   from the caller's own JWT-derived identity (CLAUDE.md invariant #11) — there is no
   chapterId parameter sourced from a request body anywhere in this call chain.

   @FilePath is NOT a caller-supplied path — it is the storage-relative identifier
   IFileStorage generated (a GUID + extension), never the client's original filename. The
   client's original filename is kept separately, in @FileName, purely for display; it is
   never used to build a path (CLAUDE.md: never trust a client filename for the disk path).

   A staged row is a real, permanent record once consumed (mirrors the ledger's own
   append-only posture) — only STILL-UNCLAIMED rows (ConsumedDate IS NULL) are ever swept by
   a later job. Nothing here deletes or updates an existing row. */
CREATE OR ALTER PROCEDURE dbo.usp_Attachment_Stage
    @ChapterId   INT,
    @UploadedBy  INT,
    @FilePath    NVARCHAR(400),
    @FileName    NVARCHAR(260),
    @FileSize    INT,
    @ContentType NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.Member
        WHERE MemberId = @UploadedBy AND ChapterId = @ChapterId AND IsDeleted = 0
    )
        THROW 51212, 'Not permitted to stage an attachment for this chapter.', 1;

    -- Defence in depth only — the upload endpoint already rejects an empty or oversized
    -- file before this proc is ever called.
    IF @FileSize <= 0
        THROW 51213, 'The uploaded file was empty.', 1;

    DECLARE @AttachmentStagingId INT;

    BEGIN TRAN;
        INSERT dbo.AttachmentStaging (UploadedBy, ChapterId, FilePath, FileName, FileSize, ContentType)
        VALUES (@UploadedBy, @ChapterId, @FilePath, @FileName, @FileSize, @ContentType);

        SET @AttachmentStagingId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('AttachmentStaging', CAST(@AttachmentStagingId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"FileName":"', @FileName, N'"}'), @UploadedBy);
    COMMIT;

    SELECT @AttachmentStagingId AS AttachmentStagingId;
END
GO
