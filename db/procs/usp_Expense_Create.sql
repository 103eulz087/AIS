/* Records an expense and posts it to the ledger in the SAME transaction — an expense is
   an event that already happened (the receipt is in hand), so there is no draft/finalize
   ceremony the way a meeting has one. ChapterTreasurer or ChapterAdmin only (docs §3.1:
   ledger/expenses/donations/receipt uploads belong to the Treasurer, not the Secretary's
   ChapterOfficer role — this is deliberately narrower than usp_Meeting_Create).

   At least one receipt attachment is required (docs §4.6: "receipt attachments (multiple,
   at least one required)") — @AttachmentStagingIds must not be empty. Every id in it must
   already be staged (dbo.AttachmentStaging), unconsumed, and uploaded by a member of THIS
   SAME chapter — checked BEFORE the transaction opens, and the whole call is rejected if
   any one of them fails, exactly the "checked before the transaction even opens... no
   partial merge" posture usp_Meeting_SaveAttendance uses for its attendance rows.

   One insert, one claim of every staged attachment, one ledger posting, one audit row —
   all or nothing. */
CREATE OR ALTER PROCEDURE dbo.usp_Expense_Create
    @ChapterId INT,
    @RequestingMemberId INT,
    @Payee       NVARCHAR(200),
    @Amount      DECIMAL(18,2),
    @ExpenseDate DATE,
    @CategoryId  INT = NULL,
    @ActivityId  INT = NULL,
    @Description NVARCHAR(MAX) = NULL,
    @AttachmentStagingIds dbo.IntList READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF NOT EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role   r ON r.RoleId = mr.RoleId
        JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName IN ('ChapterTreasurer', 'ChapterAdmin')
    )
        THROW 51190, 'Only the chapter treasurer or chapter admin may record an expense.', 1;

    IF @Amount <= 0
        THROW 51191, 'Expense amount must be greater than zero.', 1;

    IF NOT EXISTS (SELECT 1 FROM @AttachmentStagingIds)
        THROW 51192, 'At least one receipt attachment is required to record an expense.', 1;

    IF @CategoryId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.ExpenseCategory WHERE CategoryId = @CategoryId)
        THROW 51193, 'Unrecognised expense category.', 1;

    IF @ActivityId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.Activity WHERE ActivityId = @ActivityId AND ChapterId = @ChapterId
    )
        THROW 51194, 'Activity not found for this chapter.', 1;

    /* Every staged id must exist, belong to THIS chapter, and still be unclaimed — or the
       whole call is rejected. Anti-enumeration is not a concern here (the caller already
       owns the staging ids it just uploaded), so the message can be specific. */
    IF EXISTS (
        SELECT 1 FROM @AttachmentStagingIds ids
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.AttachmentStaging s
            WHERE s.AttachmentStagingId = ids.Value
              AND s.ChapterId = @ChapterId
              AND s.ConsumedDate IS NULL
        )
    )
        THROW 51195, 'One or more attachments are missing, already used, or do not belong to this chapter. Nothing was recorded.', 1;

    DECLARE @ExpenseId INT, @NewLedgerEntryId INT;

    BEGIN TRAN;
        INSERT dbo.Expense (ChapterId, ActivityId, ExpenseDate, Payee, Description, Amount,
                             CategoryId, RecordedBy, ApprovedBy, IsDeleted)
        VALUES (@ChapterId, @ActivityId, @ExpenseDate, @Payee, ISNULL(@Description, N''), @Amount,
                @CategoryId, @RequestingMemberId, NULL, 0);

        SET @ExpenseId = SCOPE_IDENTITY();

        INSERT dbo.ExpenseAttachment (ExpenseId, FilePath, FileName, FileSize, UploadedBy, ContentType)
        SELECT @ExpenseId, s.FilePath, s.FileName, s.FileSize, s.UploadedBy, s.ContentType
        FROM   dbo.AttachmentStaging s
        JOIN   @AttachmentStagingIds ids ON ids.Value = s.AttachmentStagingId;

        UPDATE dbo.AttachmentStaging
           SET ConsumedDate = SYSUTCDATETIME()
         WHERE AttachmentStagingId IN (SELECT Value FROM @AttachmentStagingIds);

        INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                                SourceType, SourceId, ActivityId, CreatedBy)
        VALUES (@ChapterId, @ExpenseDate, 'Out', @Amount,
                CONCAT(N'Expense — ', @Payee), 'Expense', @ExpenseId, @ActivityId, @RequestingMemberId);

        SET @NewLedgerEntryId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Expense', CAST(@ExpenseId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"Amount":', @Amount, N',"LedgerEntryId":', @NewLedgerEntryId, N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @ExpenseId AS ExpenseId, @NewLedgerEntryId AS LedgerEntryId;
END
GO
