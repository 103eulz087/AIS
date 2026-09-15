/* Draft-only edit. A finalized meeting is read-only — corrections go through
   usp_Meeting_Reopen, never a silent edit here. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_Update
    @MeetingId INT,
    @RequestingMemberId INT,
    @Subject     NVARCHAR(250),
    @MeetingDate DATE,
    @Location    NVARCHAR(250) = NULL,
    @Body        NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT, @IsFinalized BIT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @IsFinalized = IsFinalized
    FROM dbo.Meeting WHERE MeetingId = @MeetingId;

    IF @ChapterId IS NULL THROW 51155, 'Meeting not found.', 1;
    IF @IsFinalized = 1 THROW 51156, 'This meeting is finalized. Only a draft meeting can be edited.', 1;

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
        THROW 51157, 'Only a chapter officer or chapter admin may edit this meeting.', 1;

    BEGIN TRAN;
        UPDATE dbo.Meeting
           SET Subject     = @Subject,
               MeetingDate = @MeetingDate,
               Location    = @Location,
               Body        = @Body
         WHERE MeetingId = @MeetingId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Meeting', CAST(@MeetingId AS NVARCHAR(40)), 'Update',
                CONCAT(N'{"MeetingDate":"', CONVERT(NVARCHAR(10), @MeetingDate, 23), N'"}'),
                @RequestingMemberId);
    COMMIT;
END
GO
