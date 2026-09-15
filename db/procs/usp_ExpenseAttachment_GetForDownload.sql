/* Scoped lookup so an already-attached receipt can be viewed through the expense that
   owns it. dbo.ExpenseAttachment.AttachmentId is its OWN id space — a different one from
   dbo.AttachmentStaging.AttachmentStagingId that GET /api/attachments/{id} understands —
   so this is a separate proc, not a reuse of usp_Attachment_GetForDownload.

   Anti-enumeration: a nonexistent expense, a nonexistent attachment, an attachment that
   belongs to a different expense, and a wrong-chapter caller all get the SAME "not found"
   — same posture as usp_Expense_Get / usp_Attachment_GetForDownload. */
CREATE OR ALTER PROCEDURE dbo.usp_ExpenseAttachment_GetForDownload
    @ExpenseId          INT,
    @AttachmentId       INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId FROM dbo.Expense WHERE ExpenseId = @ExpenseId;

    IF @ChapterId IS NULL
        THROW 51215, 'Attachment not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51215, 'Attachment not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.ExpenseAttachment
                   WHERE AttachmentId = @AttachmentId AND ExpenseId = @ExpenseId)
        THROW 51215, 'Attachment not found.', 1;

    SELECT FilePath, FileName, ContentType
    FROM   dbo.ExpenseAttachment
    WHERE  AttachmentId = @AttachmentId AND ExpenseId = @ExpenseId;
END
GO
