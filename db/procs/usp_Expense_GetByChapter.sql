/* Paged expense list for a chapter. Any member of the chapter may read it — this is a
   transparency system; expenses are visible to the whole chapter, not only officers.
   Shape matches usp_Meeting_GetByChapter / usp_Ledger_GetByChapter: COUNT(*) OVER() for
   TotalCount, newest first. @IncludeVoided = 0 (default) hides voided expenses from the
   everyday list; set to 1 to include them (they always carry IsDeleted = 1 and appear
   with their void reason via usp_Expense_Get, never silently re-shown as live). */
CREATE OR ALTER PROCEDURE dbo.usp_Expense_GetByChapter
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50,
    @ActivityId INT = NULL,
    @CategoryId INT = NULL,
    @FromDate   DATE = NULL,
    @ToDate     DATE = NULL,
    @IncludeVoided BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51200, 'Not permitted to read this chapter''s expenses.', 1;

    SELECT  ex.ExpenseId, ex.ActivityId, a.ActivityName, ex.ExpenseDate, ex.Payee,
            ex.Description, ex.Amount, ex.CategoryId, ec.CategoryName,
            ex.RecordedBy, ex.ApprovedBy, ex.IsDeleted,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Expense ex
            LEFT JOIN dbo.Activity a ON a.ActivityId = ex.ActivityId
            LEFT JOIN dbo.ExpenseCategory ec ON ec.CategoryId = ex.CategoryId
    WHERE   ex.ChapterId = @ChapterId
      AND   (@IncludeVoided = 1 OR ex.IsDeleted = 0)
      AND   (@ActivityId IS NULL OR ex.ActivityId = @ActivityId)
      AND   (@CategoryId IS NULL OR ex.CategoryId = @CategoryId)
      AND   (@FromDate   IS NULL OR ex.ExpenseDate >= @FromDate)
      AND   (@ToDate     IS NULL OR ex.ExpenseDate <= @ToDate)
    ORDER BY ex.ExpenseDate DESC, ex.ExpenseId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
