/* Reference data — the controlled skill list (docs §4.2: "skills are a controlled tag list,
   not free text"). Only active skills are offered; usp_Member_UpdateOwnProfile separately
   re-validates IsActive server-side regardless of what this list showed the client. */
CREATE OR ALTER PROCEDURE dbo.usp_Skill_List
AS
BEGIN
    SET NOCOUNT ON;

    SELECT SkillId, SkillName
    FROM   dbo.Skill
    WHERE  IsActive = 1
    ORDER BY SkillName;
END
GO
