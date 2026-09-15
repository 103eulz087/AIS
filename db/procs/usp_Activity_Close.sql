/* Marks an activity closed. Reuses dbo.Activity.IsClosed — the column already exists on
   the table this proc did not need to add anything to. ChapterOfficer/ChapterAdmin only,
   same bar as usp_Activity_Create. There is no "reopen" — an activity is not append-only
   like the ledger, but nothing in this slice asks for un-closing one; if that need shows
   up later it gets its own proc rather than a silent flip back here. */
CREATE OR ALTER PROCEDURE dbo.usp_Activity_Close
    @ActivityId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT, @IsClosed BIT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @IsClosed = IsClosed
    FROM dbo.Activity WHERE ActivityId = @ActivityId;

    IF @ChapterId IS NULL THROW 51187, 'Activity not found.', 1;
    IF @IsClosed = 1 THROW 51188, 'This activity is already closed.', 1;

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
        THROW 51189, 'Only a chapter officer or chapter admin may close an activity.', 1;

    BEGIN TRAN;
        UPDATE dbo.Activity SET IsClosed = 1 WHERE ActivityId = @ActivityId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Activity', CAST(@ActivityId AS NVARCHAR(40)), 'Close', N'{}', @RequestingMemberId);
    COMMIT;
END
GO
