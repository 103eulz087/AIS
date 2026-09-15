/* Records attendance and posts the collection to the ledger as ONE entry.
   Contributions are voluntary: zero is normal and no arrears is ever derived.

   Concurrency (the reason for this comment): the finalize flip is a CONDITIONAL
   UPDATE done INSIDE the transaction (IsFinalized = 0 -> 1, checked via @@ROWCOUNT).
   Two simultaneous @Finalize = 1 callers cannot both post a ledger entry for the
   same meeting — SQL Server's row lock on the dbo.Meeting row serializes them, and
   whichever transaction commits second sees @@ROWCOUNT = 0 and throws BEFORE any
   ledger row is inserted (SET XACT_ABORT ON rolls its whole transaction back).
   Do not "optimize" this by reading IsFinalized earlier and branching on the value —
   that read-then-write gap is exactly the bug this replaces. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_SaveAttendance
    @RequestingMemberId INT,
    @MeetingId INT,
    @Rows      dbo.AttendanceRow READONLY,
    @Finalize  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT, @IsFinalized BIT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @IsFinalized = IsFinalized
    FROM dbo.Meeting WHERE MeetingId = @MeetingId;

    IF @ChapterId IS NULL THROW 51030, 'Meeting not found.', 1;
    IF @IsFinalized = 1 THROW 51031, 'This meeting is finalized. Attendance can no longer be edited.', 1;

    /* SAVE requires an active ChapterOfficer or ChapterAdmin role in THIS chapter —
       not merely membership in it. */
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
          AND r.RoleName IN ('ChapterOfficer', 'ChapterAdmin')
    )
        THROW 51032, 'Only a chapter officer or chapter admin may record attendance.', 1;

    /* FINALIZE is stricter than SAVE: ChapterAdmin only. */
    IF @Finalize = 1 AND NOT EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role   r ON r.RoleId = mr.RoleId
        JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName = 'ChapterAdmin'
    )
        THROW 51152, 'Only the chapter admin may finalize a meeting.', 1;

    /* Scoping hole (now closed): every row in @Rows must be an undeleted member of
       THIS chapter, or the ENTIRE call is rejected — no partial merge. Checked
       before the transaction even opens, so a bad row touches nothing. */
    IF EXISTS (
        SELECT 1 FROM @Rows r
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.Member m
            WHERE m.MemberId = r.MemberId AND m.ChapterId = @ChapterId AND m.IsDeleted = 0
        )
    )
        THROW 51150, 'One or more members in this attendance sheet do not belong to this chapter. Nothing was saved.', 1;

    IF EXISTS (
        SELECT 1 FROM @Rows r
        WHERE NOT EXISTS (SELECT 1 FROM dbo.AttendanceStatus s WHERE s.AttendanceStatusId = r.AttendanceStatusId)
    )
        THROW 51151, 'Unrecognised attendance status.', 1;

    DECLARE @RowCount INT = (SELECT COUNT(*) FROM @Rows);
    DECLARE @Total DECIMAL(18,2) = NULL, @NewLedgerEntryId INT = NULL;

    BEGIN TRAN;
        /* FundAmount is independent of AttendanceStatusId by design — an Excused
           or Absent brother may still have sent a contribution. Never rejected,
           never zeroed, never given a different code path. */
        MERGE dbo.MeetingAttendance AS t
        USING (SELECT MemberId, AttendanceStatusId, FundAmount, CheckedInVia FROM @Rows) AS s
           ON t.MeetingId = @MeetingId AND t.MemberId = s.MemberId
        WHEN MATCHED THEN UPDATE SET
            AttendanceStatusId = s.AttendanceStatusId,
            FundAmount         = s.FundAmount,
            CheckedInVia       = COALESCE(s.CheckedInVia, t.CheckedInVia)
        WHEN NOT MATCHED THEN
            INSERT (MeetingId, MemberId, AttendanceStatusId, FundAmount, CheckedInAt, CheckedInVia)
            VALUES (@MeetingId, s.MemberId, s.AttendanceStatusId, s.FundAmount,
                    SYSUTCDATETIME(), s.CheckedInVia);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MeetingAttendance', CAST(@MeetingId AS NVARCHAR(40)), 'SaveAttendance',
                CONCAT(N'{"RowCount":', @RowCount, N',"Finalize":', @Finalize, N'}'),
                @RequestingMemberId);

        IF @Finalize = 1
        BEGIN
            /* THE fix for the race condition. A conditional update, checked by
               @@ROWCOUNT, inside this transaction. See header comment. */
            UPDATE dbo.Meeting
               SET IsFinalized = 1, FinalizedBy = @RequestingMemberId, FinalizedDate = SYSUTCDATETIME()
             WHERE MeetingId = @MeetingId AND IsFinalized = 0;

            IF @@ROWCOUNT = 0
                THROW 51153, 'This meeting has already been finalized.', 1;

            SET @Total = (SELECT SUM(FundAmount) FROM dbo.MeetingAttendance WHERE MeetingId = @MeetingId);

            IF @Total > 0
            BEGIN
                INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                                        SourceType, SourceId, CreatedBy)
                SELECT @ChapterId, m.MeetingDate, 'In', @Total,
                       CONCAT(N'Meeting collection — ', m.Subject),
                       'Meeting', @MeetingId, @RequestingMemberId
                FROM dbo.Meeting m WHERE m.MeetingId = @MeetingId;

                SET @NewLedgerEntryId = SCOPE_IDENTITY();
            END

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('Meeting', CAST(@MeetingId AS NVARCHAR(40)), 'Finalize',
                    CONCAT(N'{"Total":', ISNULL(CAST(@Total AS NVARCHAR(30)), N'0'),
                           N',"LedgerEntryId":', ISNULL(CAST(@NewLedgerEntryId AS NVARCHAR(20)), N'null'), N'}'),
                    @RequestingMemberId);
        END
    COMMIT;

    SELECT @MeetingId AS MeetingId, @RowCount AS RowsSaved, @Finalize AS Finalized,
           @NewLedgerEntryId AS LedgerEntryId;
END
GO
