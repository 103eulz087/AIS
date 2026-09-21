/* ============================================================================
   Fixes: PI BETA CHAPTER (ChapterId 150, ChapterRegistration 65) never got
   reparented onto "Cebu City Council" the way KAPPA GAMMA (148) and ETA SIGMA
   (149) did in scripts/seed-cebucity-council.sql -- that script's fix was
   hardcoded to WHERE ChapterId IN (148, 149) and simply never mentioned 150,
   most likely because Pi Beta's registration was approved separately (it
   needed its own individual enrolment-reissue script,
   scripts/reissue-pibeta-president-link.sql, rather than being bundled into
   scripts/reissue-cebu-chapter-presidents.sql with the other two).

   Net effect: Pi Beta is still parented wherever chapter-registration approval
   originally routed it (likely the Cebu Provincial Council, same place 148/149
   were stuck before their fix -- CLAUDE.md §8.9), so usp_Chapter_ListPublic
   never resolves it under "Cebu City" and it does not appear in the Apply.tsx
   sign-up picker.

   Confirms the chapter's ACTUALLY chosen geography from its own
   ChapterRegistration row (source of truth per CLAUDE.md §8.9) before
   reparenting -- stops rather than guesses if Pi Beta's registration did not
   in fact choose Cebu City.

   Safe to re-run: the UPDATE only touches ChapterId 150, and running it twice
   is a no-op once ParentCouncilId already matches.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ChapterId INT = 150;

DECLARE @CebuCityCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'Cebu City Council');
IF @CebuCityCouncilId IS NULL
    THROW 51099, 'Cebu City Council does not exist yet -- run scripts/seed-cebucity-council.sql first.', 1;

DECLARE @RegisteredMunicipality NVARCHAR(100) = (
    SELECT m.MunicipalityName
    FROM dbo.ChapterRegistration cr
    JOIN dbo.Municipality m ON m.MunicipalityId = cr.MunicipalityId
    WHERE cr.CreatedChapterId = @ChapterId);

IF @RegisteredMunicipality IS NULL
    THROW 51099, 'Could not find a ChapterRegistration whose CreatedChapterId = 150 -- stopping rather than guessing.', 1;

IF @RegisteredMunicipality <> 'Cebu City'
BEGIN
    DECLARE @WrongMunicipalityMsg NVARCHAR(400) =
        'Pi Beta''s ChapterRegistration chose a municipality other than Cebu City (' + @RegisteredMunicipality + ') -- this is the wrong fix for it. Stopping.';
    THROW 51099, @WrongMunicipalityMsg, 1;
END

DECLARE @CurrentParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);
PRINT 'Pi Beta current ParentCouncilId: ' + ISNULL(CAST(@CurrentParentCouncilId AS NVARCHAR(20)), '<chapter not found>');

BEGIN TRAN;
    UPDATE dbo.Chapter SET ParentCouncilId = @CebuCityCouncilId WHERE ChapterId = @ChapterId;
COMMIT;

PRINT 'Cebu City Council id: ' + CAST(@CebuCityCouncilId AS NVARCHAR(20));
PRINT '--- usp_Chapter_ListPublic now returns ---';
EXEC dbo.usp_Chapter_ListPublic;
