/* Creates a chapter activity/project — the first-class entity Expenses and Donations
   both reference (CLAUDE.md / docs §4.6: "the Clean-Up Drive received ₱15,000 and spent
   ₱12,400"). ChapterOfficer or ChapterAdmin only: organizing an activity is chapter
   business, same bar as creating a meeting (usp_Meeting_Create) — not Treasurer-only,
   since an activity itself moves no money; only the Expense/Donation rows that later
   reference it do, and those already carry their own Treasurer/Admin gate.

   IsClosed starts at 0 — an activity is always born open (dbo.Activity already carries
   this column; nothing new is added to the table). */
CREATE OR ALTER PROCEDURE dbo.usp_Activity_Create
    @ChapterId INT,
    @RequestingMemberId INT,
    @Name        NVARCHAR(200),
    @Description NVARCHAR(MAX) = NULL,
    @ActivityDate DATE = NULL
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
        THROW 51185, 'Only a chapter officer or chapter admin may create an activity.', 1;

    DECLARE @ActivityId INT;

    BEGIN TRAN;
        INSERT dbo.Activity (ChapterId, ActivityName, ActivityDate, Description, IsClosed)
        VALUES (@ChapterId, @Name, @ActivityDate, @Description, 0);

        SET @ActivityId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Activity', CAST(@ActivityId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"ActivityName":"', @Name, N'"}'), @RequestingMemberId);
    COMMIT;

    SELECT @ActivityId AS ActivityId;
END
GO
