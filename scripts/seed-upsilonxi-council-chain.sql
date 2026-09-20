/* ============================================================================
   Fixes: "Upsilon Xi" (ChapterId 134) does not appear under Region 7 in the
   member sign-up picker (Apply.tsx / usp_Chapter_ListPublic).

   Root cause (CLAUDE.md §8.9): council creation/seating has no UI or API yet,
   so when this chapter's registration was approved, approval routing (§13a)
   fell back to the nearest existing ancestor with seated officers, which was
   National directly (Chapter.ParentCouncilId = 1). usp_Chapter_ListPublic
   infers Region/Province/City by walking that parent chain upward, so with
   no Regional/Provincial/City council above it, all three resolve NULL and
   the chapter (and "Region 7") never appear in the cascading picker.

   The chapter's ACTUALLY chosen geography survives on its ChapterRegistration
   row (RegistrationId 55) and is used as the source of truth here, not a
   guess: RegionId 11 "Region 7", ProvinceId 25 "Cebu Province",
   MunicipalityId 484 "Lapu-Lapu City".

   This builds the missing National -> Regional -> Provincial -> City/Municipal
   chain by hand, the same raw-INSERT way db/seed/02_demo_chapter.sql built the
   Region IV-A / Laguna / Sta. Rosa demo chain (bypassing usp_Council_Create's
   ordering check, which requires a chapter ALREADY parented under the new
   council -- a chicken-and-egg problem when building a chain root-down by
   hand), then reparents Chapter.ParentCouncilId onto the new City/Municipal
   council.

   Safe to re-run: every INSERT is guarded by an IF NOT EXISTS on CouncilName.

   NOT done by this script, on purpose -- a separate, deliberate step:
     - Seating officers on the three new councils (usp_Council_SeatOfficer).
       They will show as dormant (no seated officers) until that happens.
       Per §13a, that is not a bug -- a dormant council still blocks nothing
       that can bootstrap-route to National, and seating needs a real,
       deliberate choice of who sits in each seat, same as any chapter's own
       registration -- not something to script blind.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @National INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'National Council');
DECLARE @ChapterId INT = 134; -- Upsilon Xi, verified above
DECLARE @RegionId INT, @ProvinceId INT, @MunicipalityId INT;

SELECT @RegionId = RegionId, @ProvinceId = ProvinceId, @MunicipalityId = MunicipalityId
FROM dbo.ChapterRegistration WHERE CreatedChapterId = @ChapterId;

IF @National IS NULL
    THROW 51090, 'National Council not found -- environment is not bootstrapped. Stopping.', 1;
IF (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId) <> @National
    THROW 51091, 'Upsilon Xi is no longer parented directly to National -- someone already fixed this, or the chapter id changed. Stopping rather than guessing.', 1;

DECLARE @RegionName NVARCHAR(150) = (SELECT RegionName FROM dbo.Region WHERE RegionId = @RegionId);
DECLARE @ProvinceName NVARCHAR(150) = (SELECT ProvinceName FROM dbo.Province WHERE ProvinceId = @ProvinceId);
DECLARE @MunicipalityName NVARCHAR(150) = (SELECT MunicipalityName FROM dbo.Municipality WHERE MunicipalityId = @MunicipalityId);

DECLARE @RegionCouncilName NVARCHAR(150) = @RegionName + N' Council';
DECLARE @ProvinceCouncilName NVARCHAR(150) = @ProvinceName + N' Council';
DECLARE @CityCouncilName NVARCHAR(150) = @MunicipalityName + N' Council';

BEGIN TRAN;

    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = @RegionCouncilName)
    INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, RegionId)
    SELECT @National, CouncilLevelId, @RegionCouncilName, @RegionId
    FROM dbo.CouncilLevel WHERE LevelName = 'Regional';
    DECLARE @RegionCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = @RegionCouncilName);

    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = @ProvinceCouncilName)
    INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, ProvinceId)
    SELECT @RegionCouncilId, CouncilLevelId, @ProvinceCouncilName, @ProvinceId
    FROM dbo.CouncilLevel WHERE LevelName = 'Provincial';
    DECLARE @ProvinceCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = @ProvinceCouncilName);

    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = @CityCouncilName)
    INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, MunicipalityId)
    SELECT @ProvinceCouncilId, CouncilLevelId, @CityCouncilName, @MunicipalityId
    FROM dbo.CouncilLevel WHERE LevelName = 'City/Municipal';
    DECLARE @CityCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = @CityCouncilName);

    UPDATE dbo.Chapter SET ParentCouncilId = @CityCouncilId WHERE ChapterId = @ChapterId;

COMMIT;

PRINT '--- Chain built ---';
PRINT 'Region council:   ' + @RegionCouncilName + ' (' + CAST(@RegionCouncilId AS NVARCHAR(20)) + ')';
PRINT 'Province council: ' + @ProvinceCouncilName + ' (' + CAST(@ProvinceCouncilId AS NVARCHAR(20)) + ')';
PRINT 'City council:     ' + @CityCouncilName + ' (' + CAST(@CityCouncilId AS NVARCHAR(20)) + ')';
PRINT 'Upsilon Xi reparented under the City/Municipal council.';

PRINT '--- usp_Chapter_ListPublic now returns ---';
EXEC dbo.usp_Chapter_ListPublic;
