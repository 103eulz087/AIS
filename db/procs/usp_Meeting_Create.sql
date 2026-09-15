/* Creates a draft meeting. ChapterOfficer or ChapterAdmin only.
   IsFinalized starts at 0 — a meeting is always born a draft. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_Create
    @ChapterId INT,
    @RequestingMemberId INT,
    @Subject     NVARCHAR(250),
    @MeetingDate DATE,
    @Location    NVARCHAR(250) = NULL,
    @Body        NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

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
        THROW 51154, 'Only a chapter officer or chapter admin may create a meeting.', 1;

    DECLARE @MeetingId INT;

    BEGIN TRAN;
        INSERT dbo.Meeting (ChapterId, Subject, MeetingDate, Body, Location, IsFinalized, CreatedBy)
        VALUES (@ChapterId, @Subject, @MeetingDate, @Body, @Location, 0, @RequestingMemberId);

        SET @MeetingId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Meeting', CAST(@MeetingId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"MeetingDate":"', CONVERT(NVARCHAR(10), @MeetingDate, 23), N'"}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @MeetingId AS MeetingId;
END
GO
