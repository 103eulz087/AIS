/* Removes one member's attendance row for a meeting. ChapterOfficer/ChapterAdmin
   only, and only while the meeting is still a draft. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_ClearAttendance
    @MeetingId INT,
    @MemberId  INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT, @IsFinalized BIT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @IsFinalized = IsFinalized
    FROM dbo.Meeting WHERE MeetingId = @MeetingId;

    IF @ChapterId IS NULL THROW 51160, 'Meeting not found.', 1;
    IF @IsFinalized = 1 THROW 51161, 'This meeting is finalized. Attendance can no longer be edited.', 1;

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
        THROW 51162, 'Only a chapter officer or chapter admin may clear attendance.', 1;

    BEGIN TRAN;
        DELETE dbo.MeetingAttendance WHERE MeetingId = @MeetingId AND MemberId = @MemberId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MeetingAttendance', CAST(@MeetingId AS NVARCHAR(40)), 'ClearAttendance',
                CONCAT(N'{"MemberId":', @MemberId, N'}'), @RequestingMemberId);
    COMMIT;
END
GO
