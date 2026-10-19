/* ============================================================================
   Spelling correction (2026-10-19): "Maycauayan" -> "Meycauayan" (Bulacan, code 1122).

   db/seed/05_ph_geography.sql had the city misspelled. Its MERGE matches on province +
   municipality code and only inserts missing rows, so fixing the seed alone never touches
   a database already seeded. This corrects the existing municipality row and the city
   council auto-created from it ("Maycauayan Council"), renamed in place — never deleted
   or re-created (invariant #15); everything referencing them keeps the same ids.

   Runs before the seed (schema -> procs -> seed), so on a fresh database it finds nothing
   to correct and the seed then inserts the right spelling. Idempotent: matches only the
   old spelling. Each rename is audited in the same transaction (invariant #10).
   ============================================================================ */
SET XACT_ABORT ON;
BEGIN TRAN;

    DECLARE @Fixed TABLE (TableName NVARCHAR(80), RecordId NVARCHAR(40), OldName NVARCHAR(150), NewName NVARCHAR(150));

    UPDATE m
       SET MunicipalityName = N'Meycauayan'
    OUTPUT N'Municipality', CAST(inserted.MunicipalityId AS NVARCHAR(40)), deleted.MunicipalityName, inserted.MunicipalityName
      INTO @Fixed (TableName, RecordId, OldName, NewName)
    FROM   dbo.Municipality m
           JOIN dbo.Province p ON p.ProvinceId = m.ProvinceId
    WHERE  m.MunicipalityName = N'Maycauayan' AND m.MunicipalityCode = 1122 AND p.ProvinceCode = 16;

    UPDATE dbo.Council
       SET CouncilName = REPLACE(CouncilName, N'Maycauayan', N'Meycauayan')
    OUTPUT N'Council', CAST(inserted.CouncilId AS NVARCHAR(40)), deleted.CouncilName, inserted.CouncilName
      INTO @Fixed (TableName, RecordId, OldName, NewName)
    WHERE  CouncilName LIKE N'%Maycauayan%';

    INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
    SELECT TableName, RecordId, N'SpellingFix',
           CONCAT(N'{"Name":"', OldName, N'"}'), CONCAT(N'{"Name":"', NewName, N'"}'), NULL
    FROM   @Fixed;

COMMIT;
GO
