/* One expense, in full. Any member of the expense's own chapter may read it — a member
   of a different chapter is rejected with the SAME "not found" message as a nonexistent
   id (anti-enumeration, same pattern as usp_Meeting_Get).

   Three result sets: the expense header, its attachments, and its void history (if any —
   empty when live). */
CREATE OR ALTER PROCEDURE dbo.usp_Expense_Get
    @ExpenseId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId FROM dbo.Expense WHERE ExpenseId = @ExpenseId;

    IF @ChapterId IS NULL
        THROW 51201, 'Expense not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51201, 'Expense not found.', 1;

    -- 1. Header
    SELECT  ex.ExpenseId, ex.ChapterId, ex.ActivityId, a.ActivityName, ex.ExpenseDate,
            ex.Payee, ex.Description, ex.Amount, ex.CategoryId, ec.CategoryName,
            ex.RecordedBy, ex.ApprovedBy, ex.IsDeleted
    FROM    dbo.Expense ex
            LEFT JOIN dbo.Activity a ON a.ActivityId = ex.ActivityId
            LEFT JOIN dbo.ExpenseCategory ec ON ec.CategoryId = ex.CategoryId
    WHERE   ex.ExpenseId = @ExpenseId;

    -- 2. Attachments
    SELECT  ea.AttachmentId, ea.FilePath, ea.FileName, ea.FileSize, ea.UploadedBy
    FROM    dbo.ExpenseAttachment ea
    WHERE   ea.ExpenseId = @ExpenseId
    ORDER BY ea.AttachmentId ASC;

    -- 3. Void history
    SELECT  ev.ExpenseVoidId, ev.VoidedBy, ev.VoidedDate, ev.Reason, ev.ReversedLedgerEntryId
    FROM    dbo.ExpenseVoid ev
    WHERE   ev.ExpenseId = @ExpenseId
    ORDER BY ev.VoidedDate ASC, ev.ExpenseVoidId ASC;
END
GO
