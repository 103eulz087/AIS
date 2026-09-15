/* Scoped lookup for GET /api/attachments/{id}. Returns the storage-relative FilePath (which
   IFileStorage — never this proc, never the caller — resolves to actual bytes), the
   original FileName for the download's display name, and ContentType.

   Works identically whether the row is still unclaimed (ConsumedDate IS NULL) or has since
   been claimed by an expense (ConsumedDate set) — dbo.AttachmentStaging is never deleted for
   a consumed row, only for a still-unclaimed one by a later sweep job, so the id the client
   received from POST /api/attachments keeps working for as long as the file exists.

   Anti-enumeration: a nonexistent id and a wrong-chapter caller get the SAME "not found"
   message — same posture as usp_Expense_Get / usp_Donation_Get / usp_Meeting_Get. */
CREATE OR ALTER PROCEDURE dbo.usp_Attachment_GetForDownload
    @AttachmentStagingId INT,
    @RequestingMemberId  INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId
    FROM dbo.AttachmentStaging
    WHERE AttachmentStagingId = @AttachmentStagingId;

    IF @ChapterId IS NULL
        THROW 51214, 'Attachment not found.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.Member
        WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0
    )
        THROW 51214, 'Attachment not found.', 1;

    SELECT FilePath, FileName, ContentType
    FROM dbo.AttachmentStaging
    WHERE AttachmentStagingId = @AttachmentStagingId;
END
GO
