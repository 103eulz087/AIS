/* One number the dashboard can show at a glance: the chapter's running fund balance, plus
   the two totals it's made of. Scoped the same way usp_Ledger_GetByChapter already is —
   any member of the chapter may read it, nobody else.

   A reversal already carries its own In/Out EntryType (see usp_Ledger_Reverse), so a
   plain SUM by type already nets out every correction correctly — no separate handling
   needed for IsReversal rows. */
CREATE OR ALTER PROCEDURE dbo.usp_Ledger_GetSummary
    @RequestingMemberId INT,
    @ChapterId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51020, 'Not permitted to read this chapter''s ledger.', 1;

    SELECT
        ISNULL(SUM(CASE WHEN EntryType = 'In'  THEN Amount ELSE 0 END), 0) AS CashIn,
        ISNULL(SUM(CASE WHEN EntryType = 'Out' THEN Amount ELSE 0 END), 0) AS CashOut,
        ISNULL(SUM(CASE WHEN EntryType = 'In' THEN Amount ELSE -Amount END), 0) AS Balance
    FROM dbo.LedgerEntry
    WHERE ChapterId = @ChapterId;
END
GO
