/* Records attendance and posts the collection to the ledger as ONE entry.
   Contributions are voluntary: zero is normal and no arrears is derived. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_SaveAttendance
    @RequestingMemberId INT,
    @MeetingId INT,
    @Rows      dbo.AttendanceRow READONLY,
    @Finalize  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT, @IsFinalized BIT;
    SELECT @ChapterId = ChapterId, @IsFinalized = IsFinalized
    FROM dbo.Meeting WHERE MeetingId = @MeetingId;

    IF @ChapterId IS NULL THROW 51030, 'Meeting not found.', 1;
    IF @IsFinalized = 1 THROW 51031, 'This meeting is finalized. Attendance can no longer be edited.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId)
        THROW 51032, 'Not permitted to record attendance for this chapter.', 1;

    BEGIN TRAN;
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

        IF @Finalize = 1
        BEGIN
            DECLARE @Total DECIMAL(18,2) =
                (SELECT SUM(FundAmount) FROM dbo.MeetingAttendance WHERE MeetingId = @MeetingId);

            IF @Total > 0
                INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                                        SourceType, SourceId, CreatedBy)
                SELECT @ChapterId, m.MeetingDate, 'In', @Total,
                       CONCAT(N'Meeting collection — ', m.Subject),
                       'Meeting', @MeetingId, @RequestingMemberId
                FROM dbo.Meeting m WHERE m.MeetingId = @MeetingId;

            UPDATE dbo.Meeting
               SET IsFinalized = 1, FinalizedBy = @RequestingMemberId, FinalizedDate = SYSUTCDATETIME()
             WHERE MeetingId = @MeetingId;
        END
    COMMIT;
END
GO
