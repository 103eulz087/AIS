/* Reference data — same posture as usp_Region_List. @ProvinceId narrows the cascade to one
   province's cities/municipalities; NULL returns every one (rare, but no reason to forbid
   it — the list itself carries nothing sensitive). */
CREATE OR ALTER PROCEDURE dbo.usp_Municipality_List
    @ProvinceId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT MunicipalityId, ProvinceId, MunicipalityCode, MunicipalityName, ZipCode
    FROM   dbo.Municipality
    WHERE  @ProvinceId IS NULL OR ProvinceId = @ProvinceId
    ORDER BY MunicipalityName;
END
GO
