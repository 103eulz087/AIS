/* Reference data — no auth, no scoping, nothing sensitive about the list of PH regions
   itself. Feeds the cascading Region -> Province -> Municipality picker on the chapter/
   council registration module (db/schema/16_geography.sql header). */
CREATE OR ALTER PROCEDURE dbo.usp_Region_List
AS
BEGIN
    SET NOCOUNT ON;

    SELECT RegionId, RegionCode, RegionName
    FROM   dbo.Region
    ORDER BY RegionName;
END
GO
