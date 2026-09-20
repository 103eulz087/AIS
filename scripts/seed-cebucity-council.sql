/* ============================================================================
   Fixes: KAPPA GAMMA CHAPTER (134... ChapterId 148) and ETA SIGMA (ChapterId 149)
   both chose "Cebu City" on their chapter registration, but no City/Municipal-level
   council for Cebu City exists yet -- only Region 7 Council and Cebu Province Council
   (created by an earlier fix, scripts/seed-upsilonxi-council-chain.sql). Both chapters
   are currently parented directly at the Province level (ParentCouncilId = 20), so
   usp_Chapter_ListPublic resolves their CityName as NULL and they never appear in the
   member sign-up picker's City dropdown -- only "Lapu-Lapu City" (the other Cebu-area
   city, fixed earlier) shows.

   Same fix pattern as scripts/seed-upsilonxi-council-chain.sql: create the missing
   City/Municipal council under the existing Cebu Province Council, then reparent both
   chapters onto it. Idempotent, wrapped in a transaction.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CebuProvinceCouncil INT = 20;
DECLARE @CebuCityMunicipalityId INT = (
    SELECT MunicipalityId FROM dbo.Municipality m JOIN dbo.Province p ON p.ProvinceId = m.ProvinceId
    WHERE m.MunicipalityName = 'Cebu City' AND p.ProvinceName = 'Cebu Province');

IF @CebuCityMunicipalityId IS NULL
    THROW 51099, 'Could not resolve Cebu City municipality id -- stopping rather than guessing.', 1;

BEGIN TRAN;
    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = 'Cebu City Council')
    INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, MunicipalityId)
    SELECT @CebuProvinceCouncil, CouncilLevelId, 'Cebu City Council', @CebuCityMunicipalityId
    FROM dbo.CouncilLevel WHERE LevelName = 'City/Municipal';

    DECLARE @CebuCityCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'Cebu City Council');

    UPDATE dbo.Chapter SET ParentCouncilId = @CebuCityCouncilId WHERE ChapterId IN (148, 149);
COMMIT;

PRINT 'Cebu City Council id: ' + CAST(@CebuCityCouncilId AS NVARCHAR(20));
PRINT '--- usp_Chapter_ListPublic now returns ---';
EXEC dbo.usp_Chapter_ListPublic;
