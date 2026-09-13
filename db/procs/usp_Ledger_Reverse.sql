/* The ONLY way to correct a ledger entry. The original stays visible beside the reversal. */
CREATE OR ALTER PROCEDURE dbo.usp_Ledger_Reverse
    @LedgerEntryId INT,
    @Reason        NVARCHAR(400),
    @PerformedBy   INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.LedgerEntry WHERE LedgerEntryId = @LedgerEntryId)
        THROW 51021, 'Ledger entry not found.', 1;
    IF EXISTS (SELECT 1 FROM dbo.LedgerEntry WHERE ReversesEntryId = @LedgerEntryId)
        THROW 51022, 'That entry has already been reversed.', 1;

    INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                            SourceType, SourceId, ActivityId, IsReversal, ReversesEntryId,
                            CreatedBy, CreatedDate)
    SELECT ChapterId, CAST(SYSUTCDATETIME() AS DATE),
           CASE WHEN EntryType = 'In' THEN 'Out' ELSE 'In' END,
           Amount, CONCAT(N'Reversal of #', @LedgerEntryId, N': ', @Reason),
           SourceType, SourceId, ActivityId, 1, @LedgerEntryId,
           @PerformedBy, SYSUTCDATETIME()
    FROM   dbo.LedgerEntry WHERE LedgerEntryId = @LedgerEntryId;

    SELECT SCOPE_IDENTITY() AS NewLedgerEntryId;
END
GO
