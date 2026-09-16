/* Reference data — same posture as usp_Region_List. @RegionId narrows the cascade to one
   region's provinces; NULL returns every province (rare, but no reason to forbid it — the
   list itself carries nothing sensitive). */
CREATE OR ALTER PROCEDURE dbo.usp_Province_List
    @RegionId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT ProvinceId, RegionId, ProvinceCode, ProvinceName
    FROM   dbo.Province
    WHERE  @RegionId IS NULL OR RegionId = @RegionId
    ORDER BY ProvinceName;
END
GO
