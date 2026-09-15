/* Publishes a new announcement for a chapter. ChapterOfficer or ChapterAdmin only —
   same capability line as usp_Meeting_Create (AIS-Project-Documentation.md §3.1: the
   Secretary's announcements/memos line, and the Chapter Admin's "all of the above").

   ScopeType/ScopeId are written as ('Chapter', @ChapterId) every time in this slice.
   The columns are already polymorphic in dbo.Announcement for a future council-cascade
   read path — CLAUDE.md's instruction for THIS slice is chapter-authored only, so no
   'Council' scope is ever written here, and there is no proc that would let one in.

   dbo.Announcement.UrgentType (free text) is kept populated from UrgentTypeId for
   backward compatibility this release, per db/schema/08_comms_align.sql. If the
   caller doesn't mark this urgent, both UrgentTypeId and BloodTypeId are forced to
   NULL regardless of what was passed — an announcement is either urgent (with a type)
   or it isn't; there is no half-urgent state to persist. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_Create
    @ChapterId INT,
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
        THROW 51168, 'Only a chapter officer or chapter admin may post an announcement.', 1;

    IF @IsUrgent = 0
    BEGIN
        SET @UrgentTypeId = NULL;
        SET @BloodTypeId  = NULL;
    END

    DECLARE @UrgentTypeText NVARCHAR(30) =
        (SELECT TypeName FROM dbo.UrgentType WHERE UrgentTypeId = @UrgentTypeId);

    DECLARE @AnnouncementId INT;

    BEGIN TRAN;
        INSERT dbo.Announcement (ScopeType, ScopeId, Title, Body, IsUrgent, UrgentType,
                                  UrgentTypeId, BloodTypeId, PublishDate, ExpiryDate, CreatedBy)
        VALUES ('Chapter', @ChapterId, @Title, @Body, @IsUrgent, @UrgentTypeText,
                @UrgentTypeId, @BloodTypeId, SYSUTCDATETIME(), @ExpiryDate, @RequestingMemberId);

        SET @AnnouncementId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Announcement', CAST(@AnnouncementId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"ChapterId":', @ChapterId, N',"IsUrgent":', @IsUrgent, N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @AnnouncementId AS AnnouncementId;
END
GO
