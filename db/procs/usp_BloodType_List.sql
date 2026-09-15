/* Reference data — no auth, no scoping, nothing sensitive about the LIST of blood types
   itself (only a MEMBER'S OWN blood type is sensitive, per docs §8). Populates the profile
   editor's dropdown. */
CREATE OR ALTER PROCEDURE dbo.usp_BloodType_List
AS
BEGIN
    SET NOCOUNT ON;

    SELECT BloodTypeId, BloodTypeName
    FROM   dbo.BloodType
    ORDER BY BloodTypeName;
END
GO
