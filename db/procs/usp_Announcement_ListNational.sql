/* The National Council Admin's own management list — every National announcement
   ever posted, newest first, withdrawn ones included (this is the officer's own
   review screen, not a member's reading feed, so there is no @IncludeWithdrawn
   toggle to get wrong: he always sees everything he's posted). Reuses the same
   AnnouncementDto shape usp_Announcement_GetForMember hands a member, with
   UrgentTypeId/BloodTypeId/HasRead as fixed NULL/0 placeholders — this feature never
   writes those columns for a National row (usp_Announcement_CreateNational's own
   header comment) and a management list has no single "requesting member" whose own
   read state would even mean anything here. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_ListNational
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

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
        THROW 51901, 'Only the National Council Admin may view this list.', 1;

    SELECT  a.AnnouncementId, a.Title, a.Body, a.IsUrgent,
            CAST(NULL AS INT) AS UrgentTypeId, CAST(NULL AS NVARCHAR(30)) AS UrgentTypeName,
            CAST(NULL AS INT) AS BloodTypeId, CAST(NULL AS NVARCHAR(50)) AS BloodTypeName,
            a.PublishDate, a.ExpiryDate, a.CreatedBy,
            a.EditedBy, a.EditedDate,
            a.IsWithdrawn, a.WithdrawnBy, a.WithdrawnDate, a.WithdrawnReason,
            CAST(1 AS BIT) AS IsNational, CAST(0 AS BIT) AS HasRead,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Announcement a
    WHERE   a.ScopeType = 'National' AND a.ScopeId = @NationalCouncilId
    ORDER BY a.PublishDate DESC, a.AnnouncementId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
