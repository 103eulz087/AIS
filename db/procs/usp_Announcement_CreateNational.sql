/* Publishes an announcement visible to EVERY chapter AIS user in the entire
   organization — National Council Admin only. Mirrors usp_Announcement_Create's own
   shape (IsUrgent gating, AuditLog write) but writes ('National', @NationalCouncilId)
   into dbo.Announcement's already-polymorphic ScopeType/ScopeId instead of
   ('Chapter', @ChapterId) — the exact "future council-cascade read path" that
   procedure's own header comment anticipated. No UrgentTypeId/BloodTypeId here
   (client decision: those are a chapter-level blood/assistance request shape, not
   part of this national broadcast slice) — IsUrgent alone still lets a National
   notice render with the same urgent styling everywhere the chapter feed already
   does. usp_Announcement_GetForMember's own UNION is what actually surfaces this to
   every member; nothing here touches dbo.Member directly — recipient resolution for
   the push fan-out is usp_Announcement_GetRecipientMemberIds, called separately by
   the endpoint after this commits. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_CreateNational
    @RequestingMemberId INT,
    @Title       NVARCHAR(250),
    @Body        NVARCHAR(MAX),
    @IsUrgent    BIT = 0,
    @ExpiryDate  DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL
      AND  cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51900, 'The National Council is not configured.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51901, 'Only the National Council Admin may post an announcement to every chapter.', 1;

    DECLARE @AnnouncementId INT;

    BEGIN TRAN;
        INSERT dbo.Announcement (ScopeType, ScopeId, Title, Body, IsUrgent, PublishDate, ExpiryDate, CreatedBy)
        VALUES ('National', @NationalCouncilId, @Title, @Body, @IsUrgent, SYSUTCDATETIME(), @ExpiryDate, @RequestingMemberId);

        SET @AnnouncementId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Announcement', CAST(@AnnouncementId AS NVARCHAR(40)), 'CreateNational',
                CONCAT(N'{"IsUrgent":', @IsUrgent, N'}'), @RequestingMemberId);
    COMMIT;

    SELECT @AnnouncementId AS AnnouncementId;
END
GO
