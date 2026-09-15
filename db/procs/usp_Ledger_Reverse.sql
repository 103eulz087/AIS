/* The ONLY way to correct a ledger entry. The original stays visible beside the reversal.

   @RequestingMemberId and the role/chapter check below close a live scoping defect:
   this proc used to take no requester and no chapter check at all, which meant any
   authenticated member could reverse ANY chapter's ledger entry by id (invariant #4
   scoping breach writing into an append-only table — invariant #1 — with no way to
   clean up after the fact if exploited). Now the caller must hold an active
   ChapterTreasurer or ChapterAdmin role in the SAME chapter the entry belongs to.

   @NewLedgerEntryId OUTPUT lets usp_Meeting_Reopen call this proc directly and
   capture the id without depending on the SELECT below (which stays, unmodified in
   shape, so LedgerRepository.ReverseAsync — which reads it via Dapper — needs no
   change beyond passing the new @RequestingMemberId argument). It defaults to NULL
   OUTPUT so existing callers that don't pass it are unaffected. */
CREATE OR ALTER PROCEDURE dbo.usp_Ledger_Reverse
    @LedgerEntryId INT,
    @Reason        NVARCHAR(400),
    @PerformedBy   INT,
    @RequestingMemberId INT,
    @NewLedgerEntryId INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId FROM dbo.LedgerEntry WHERE LedgerEntryId = @LedgerEntryId;

    IF @ChapterId IS NULL
        THROW 51021, 'Ledger entry not found.', 1;

    /* Scoping (invariant #4): only a Treasurer or Chapter Admin of the entry's OWN
       chapter may reverse it — never a member of a different chapter. */
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
        THROW 51167, 'Not permitted to reverse this chapter''s ledger entries.', 1;

    IF EXISTS (SELECT 1 FROM dbo.LedgerEntry WHERE ReversesEntryId = @LedgerEntryId)
        THROW 51022, 'That entry has already been reversed.', 1;

    BEGIN TRAN;
        INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                                SourceType, SourceId, ActivityId, IsReversal, ReversesEntryId,
                                CreatedBy, CreatedDate)
        SELECT ChapterId, CAST(SYSUTCDATETIME() AS DATE),
               CASE WHEN EntryType = 'In' THEN 'Out' ELSE 'In' END,
               Amount, CONCAT(N'Reversal of #', @LedgerEntryId, N': ', @Reason),
               SourceType, SourceId, ActivityId, 1, @LedgerEntryId,
               @PerformedBy, SYSUTCDATETIME()
        FROM   dbo.LedgerEntry WHERE LedgerEntryId = @LedgerEntryId;

        SET @NewLedgerEntryId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('LedgerEntry', CAST(@NewLedgerEntryId AS NVARCHAR(40)), 'Reverse',
                CONCAT(N'{"ReversesEntryId":', @LedgerEntryId, N'}'), @PerformedBy);
    COMMIT;

    SELECT @NewLedgerEntryId AS NewLedgerEntryId;
END
GO
