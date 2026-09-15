/* Reopens a finalized meeting so a mistake in attendance or amounts can be corrected.
   ChapterTreasurer or ChapterAdmin only — the same people who may reverse a ledger
   entry, because reopening a meeting with money already posted IS reversing a ledger
   entry.

   One transaction: reverse the live ledger entry (if the collection total was ever
   nonzero — a zero-total finalize posts nothing, so there is nothing to reverse),
   unlock the meeting, and record the reason in dbo.MeetingReopen, which is a CHILD
   TABLE (not columns on Meeting) precisely because a meeting can be reopened more
   than once and every occurrence keeps its own reason — never overwritten.

   usp_Ledger_Reverse's own SELECT result set is captured into a table variable
   here (INSERT ... EXEC) purely to keep it out of this proc's output stream; the
   value we actually need comes back through its @NewLedgerEntryId OUTPUT parameter. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_Reopen
    @MeetingId INT,
    @Reason    NVARCHAR(400),
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51165, 'A reason of at least 10 characters is required — it will be shown to the whole chapter.', 1;

    DECLARE @ChapterId INT, @IsFinalized BIT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @IsFinalized = IsFinalized
    FROM dbo.Meeting WHERE MeetingId = @MeetingId;

    IF @ChapterId IS NULL THROW 51163, 'Meeting not found.', 1;
    IF @IsFinalized = 0 THROW 51166, 'This meeting has not been finalized. There is nothing to reopen.', 1;

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
        THROW 51164, 'Only the chapter treasurer or chapter admin may reopen a finalized meeting.', 1;

    /* The live (unreversed) original posting for this meeting, if one exists. */
    DECLARE @LiveLedgerEntryId INT;
    SELECT TOP (1) @LiveLedgerEntryId = le.LedgerEntryId
    FROM   dbo.LedgerEntry le
    WHERE  le.SourceType = 'Meeting' AND le.SourceId = @MeetingId AND le.IsReversal = 0
      AND  NOT EXISTS (SELECT 1 FROM dbo.LedgerEntry rv WHERE rv.ReversesEntryId = le.LedgerEntryId)
    ORDER BY le.LedgerEntryId DESC;

    DECLARE @ReversedLedgerEntryId INT = NULL;
    DECLARE @ReverseResult TABLE (NewLedgerEntryId INT);

    BEGIN TRAN;
        IF @LiveLedgerEntryId IS NOT NULL
        BEGIN
            INSERT INTO @ReverseResult (NewLedgerEntryId)
            EXEC dbo.usp_Ledger_Reverse
                @LedgerEntryId      = @LiveLedgerEntryId,
                @Reason             = @Reason,
                @PerformedBy        = @RequestingMemberId,
                @RequestingMemberId = @RequestingMemberId,
                @NewLedgerEntryId   = @ReversedLedgerEntryId OUTPUT;
        END
        -- else: the meeting's collection total was zero, so nothing was ever posted.
        -- The meeting still unlocks and the reason is still recorded, explicitly.

        UPDATE dbo.Meeting SET IsFinalized = 0 WHERE MeetingId = @MeetingId;

        INSERT dbo.MeetingReopen (MeetingId, ReopenedBy, Reason, ReversedLedgerEntryId)
        VALUES (@MeetingId, @RequestingMemberId, @Reason, @ReversedLedgerEntryId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Meeting', CAST(@MeetingId AS NVARCHAR(40)), 'Reopen',
                CONCAT(N'{"ReversedLedgerEntryId":',
                       ISNULL(CAST(@ReversedLedgerEntryId AS NVARCHAR(20)), N'null'), N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @MeetingId AS MeetingId, @ReversedLedgerEntryId AS ReversedLedgerEntryId;
END
GO
