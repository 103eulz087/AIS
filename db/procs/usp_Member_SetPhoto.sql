/* Claims a staged upload as the caller's own profile photo — STAGE AND CLAIM IN ONE CALL,
   deliberately NOT the two-step expense pattern (usp_Attachment_Stage now, usp_Expense_Create
   claims later). An expense doesn't exist yet at the moment its receipt is uploaded, so a
   staged-and-unclaimed window is unavoidable there; a Member row already exists the moment
   a member opens his own profile, so leaving the same window open here would just be an
   orphan-staged-row risk with no matching benefit. The upload endpoint that calls this proc
   is a SEPARATE endpoint from POST /api/attachments (backend's job, not this file's) — this
   does NOT relax POST /api/attachments' Treasurer-only policy, which stays exactly as
   AttachmentsEndpoints.cs already gates it.

   Ownership check: the staged row must have been uploaded BY THIS SAME MEMBER
   (AttachmentStaging.UploadedBy = @RequestingMemberId) and must be unconsumed
   (ConsumedDate IS NULL) — otherwise a member could claim someone else's staged file as his
   own photo. Both conditions collapse into a single "not found" so a member probing ids he
   does not own learns nothing about whether they exist. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_SetPhoto
    @RequestingMemberId  INT,
    @AttachmentStagingId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @UploadedBy INT, @FilePath NVARCHAR(400), @ContentType NVARCHAR(100), @ConsumedDate DATETIME2;

    SELECT  @UploadedBy   = UploadedBy,
            @FilePath     = FilePath,
            @ContentType  = ContentType,
            @ConsumedDate = ConsumedDate
    FROM    dbo.AttachmentStaging
    WHERE   AttachmentStagingId = @AttachmentStagingId;

    IF @UploadedBy IS NULL OR @UploadedBy <> @RequestingMemberId OR @ConsumedDate IS NOT NULL
        THROW 51246, 'That upload was not found, or has already been used.', 1;

    BEGIN TRAN;
        UPDATE dbo.Member
           SET PhotoPath        = @FilePath,
               PhotoContentType = @ContentType
         WHERE MemberId = @RequestingMemberId;

        UPDATE dbo.AttachmentStaging
           SET ConsumedDate = SYSUTCDATETIME()
         WHERE AttachmentStagingId = @AttachmentStagingId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Member', CAST(@RequestingMemberId AS NVARCHAR(40)), 'SetPhoto',
                CONCAT(N'{"AttachmentStagingId":', @AttachmentStagingId, N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @FilePath AS PhotoPath, @ContentType AS PhotoContentType;
END
GO
