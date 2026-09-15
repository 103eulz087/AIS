/* Edits an announcement in place — announcements are casual enough that typos are
   real and low-stakes, so "edit with a visible mark" is the honest middle ground
   (unlike a memo, which is a document of record and is never edited — see
   usp_Memo_Publish). EditedBy/EditedDate are what let the card show "Edited"; they
   are set unconditionally on every successful edit, even one that changes nothing
   material, because the member reading it is owed an honest "this was touched" mark,
   not this proc's guess at whether the change was material.

   A withdrawn announcement cannot be edited — withdrawal is terminal by design
   (mirrors CorrectiveAction's own "status changes only, no resurrecting" shape).
   Re-publish it as a new announcement if it needs to come back. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_Edit
    @AnnouncementId INT,
    @RequestingMemberId INT,
    @Title       NVARCHAR(250),
    @Body        NVARCHAR(MAX),
    @IsUrgent    BIT = 0,
    @UrgentTypeId INT = NULL,
    @BloodTypeId  INT = NULL,
    @ExpiryDate   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ScopeType NVARCHAR(20), @ChapterId INT, @IsWithdrawn BIT;

    SELECT @ScopeType = ScopeType, @ChapterId = ScopeId, @IsWithdrawn = IsWithdrawn
    FROM dbo.Announcement WHERE AnnouncementId = @AnnouncementId;

    IF @ChapterId IS NULL
        THROW 51169, 'Announcement not found.', 1;

    IF @IsWithdrawn = 1
        THROW 51170, 'This announcement has been withdrawn and can no longer be edited. Post a new one instead.', 1;

    IF @ScopeType <> 'Chapter'
        THROW 51169, 'Announcement not found.', 1;   -- no council-scoped announcements exist yet

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
        THROW 51171, 'Only a chapter officer or chapter admin may edit this announcement.', 1;

    IF @IsUrgent = 0
    BEGIN
        SET @UrgentTypeId = NULL;
        SET @BloodTypeId  = NULL;
    END

    DECLARE @UrgentTypeText NVARCHAR(30) =
        (SELECT TypeName FROM dbo.UrgentType WHERE UrgentTypeId = @UrgentTypeId);

    BEGIN TRAN;
        UPDATE dbo.Announcement
           SET Title        = @Title,
               Body         = @Body,
               IsUrgent     = @IsUrgent,
               UrgentType   = @UrgentTypeText,
               UrgentTypeId = @UrgentTypeId,
               BloodTypeId  = @BloodTypeId,
               ExpiryDate   = @ExpiryDate,
               EditedBy     = @RequestingMemberId,
               EditedDate   = SYSUTCDATETIME()
         WHERE AnnouncementId = @AnnouncementId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Announcement', CAST(@AnnouncementId AS NVARCHAR(40)), 'Edit',
                CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId);
    COMMIT;

    SELECT @AnnouncementId AS AnnouncementId;
END
GO
