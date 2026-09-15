/* Paged activity list for a chapter. Any member of the chapter may read it — an
   activity's existence and its open/closed state are chapter-transparent, same as a
   meeting list. Shape matches usp_Meeting_GetByChapter / usp_Ledger_GetByChapter:
   COUNT(*) OVER() for TotalCount, newest first.

   FundedTotal/SpentTotal are aggregates ACROSS the whole activity (donations received,
   expenses posted against it) — never per donor and never per member, so this stays
   inside CLAUDE.md invariant #5's line: activity-level rollups are exactly the
   transparency artifact docs §4.6 asks for ("the Clean-Up Drive received ₱15,000 and
   spent ₱12,400"); a per-person breakdown is a different question this proc never
   answers. Both totals exclude voided rows — a voided expense/donation carries no
   ledger weight and should not appear to have been spent or received. */
CREATE OR ALTER PROCEDURE dbo.usp_Activity_GetByChapter
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51186, 'Not permitted to read this chapter''s activities.', 1;

    SELECT  a.ActivityId, a.ActivityName, a.ActivityDate, a.Description, a.IsClosed,
            ISNULL(d.FundedTotal, 0) AS FundedTotal,
            ISNULL(e.SpentTotal, 0)  AS SpentTotal,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Activity a
            OUTER APPLY (
                SELECT SUM(dn.Amount) AS FundedTotal
                FROM   dbo.Donation dn
                WHERE  dn.ActivityId = a.ActivityId
                  AND  NOT EXISTS (SELECT 1 FROM dbo.DonationVoid v WHERE v.DonationId = dn.DonationId)
            ) d
            OUTER APPLY (
                SELECT SUM(ex.Amount) AS SpentTotal
                FROM   dbo.Expense ex
                WHERE  ex.ActivityId = a.ActivityId AND ex.IsDeleted = 0
            ) e
    WHERE   a.ChapterId = @ChapterId
    ORDER BY ISNULL(a.ActivityDate, '9999-12-31') DESC, a.ActivityId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
