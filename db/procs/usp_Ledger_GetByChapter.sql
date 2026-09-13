CREATE OR ALTER PROCEDURE dbo.usp_Ledger_GetByChapter
    @RequestingMemberId INT,
    @ChapterId INT,
    @FromDate  DATE = NULL,
    @ToDate    DATE = NULL,
    @Skip INT = 0,
    @Take INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    /* Scope: AIS is chapter-exclusive. Council roll-up is built but switched off
       (client decision 7). Only a member of this chapter may read its ledger. */
    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51020, 'Not permitted to read this chapter''s ledger.', 1;

    SELECT  l.LedgerEntryId, l.EntryDate, l.EntryType, l.Amount, l.Description,
            l.SourceType, l.SourceId, l.ActivityId, a.ActivityName,
            l.IsReversal, l.ReversesEntryId, l.CreatedDate,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.LedgerEntry l
            LEFT JOIN dbo.Activity a ON a.ActivityId = l.ActivityId
    WHERE   l.ChapterId = @ChapterId
      AND   (@FromDate IS NULL OR l.EntryDate >= @FromDate)
      AND   (@ToDate   IS NULL OR l.EntryDate <= @ToDate)
    ORDER BY l.EntryDate DESC, l.LedgerEntryId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
