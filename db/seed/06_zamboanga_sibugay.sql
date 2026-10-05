/* 06 - Zamboanga Sibugay and its 16 municipalities (Region IX, RegionCode '13').

   The geography dataset behind 05_ph_geography.sql predates Zamboanga Sibugay (carved out
   of Zamboanga del Sur in 2001) and filed all 16 of its municipalities under Zamboanga del
   Sur. This file puts them where they belong. Safe to run any number of times, on a fresh
   database or on the shared dev/staging DB, and safe to run by hand in SSMS:

     1. Ensures the province row exists — matched by NAME, because it was already added by
        hand on the shared DB with whatever ProvinceCode was chosen then. Only a fresh
        database gets a new row (next free ProvinceCode).
     2. For each municipality:
          - already under Zamboanga Sibugay (by code or name) -> left alone
          - still under Zamboanga del Sur (an older deploy of 05) -> MOVED, not copied:
            same MunicipalityId, so every chapter registration / council already pointing at
            it stays valid, and the picker never shows Ipil twice. Any ChapterRegistration or
            Council row pointing at it gets its ProvinceId corrected to match, audited.
          - nowhere -> inserted.
   "Reseller Lim" in the source data is a typo for Roseller Lim (named for Roseller T. Lim);
   corrected here. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRAN;

DECLARE @RegionId INT = (SELECT RegionId FROM dbo.Region WHERE RegionCode = '13');
IF @RegionId IS NULL
    THROW 50000, 'Region 9 (RegionCode 13) is missing - run 05_ph_geography.sql first.', 1;

DECLARE @ZdsId INT = (SELECT ProvinceId FROM dbo.Province WHERE ProvinceName = N'Zamboanga del Sur');

DECLARE @ZsibId INT = (SELECT TOP (1) ProvinceId FROM dbo.Province
                       WHERE ProvinceName IN (N'Zamboanga Sibugay', N'Zamboanga Sibuguey')
                       ORDER BY ProvinceId);
IF @ZsibId IS NULL
BEGIN
    INSERT dbo.Province (RegionId, ProvinceCode, ProvinceName)
    VALUES (@RegionId, (SELECT ISNULL(MAX(ProvinceCode), 0) + 1 FROM dbo.Province), N'Zamboanga Sibugay');
    SET @ZsibId = SCOPE_IDENTITY();
    INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues)
    VALUES ('Province', CAST(@ZsibId AS NVARCHAR(40)), 'Insert', N'{"ProvinceName":"Zamboanga Sibugay","Source":"seed 06"}');
END

DECLARE @Town TABLE (MunicipalityCode SMALLINT PRIMARY KEY, MunicipalityName NVARCHAR(150), OldName NVARCHAR(150), ZipCode VARCHAR(10));
INSERT @Town VALUES
 (  40, N'Alicia',       N'Alicia',       '7040'),
 ( 333, N'Buug',         N'Buug',         '7009'),
 ( 546, N'Diplahan',     N'Diplahan',     '7039'),
 ( 707, N'Imelda',       N'Imelda',       '7007'),
 ( 722, N'Ipil',         N'Ipil',         '7001'),
 ( 767, N'Kabasalan',    N'Kabasalan',    '7005'),
 ( 969, N'Mabuhay',      N'Mabuhay',      '7010'),
 (1020, N'Malangas',     N'Malangas',     '7038'),
 (1176, N'Naga',         N'Naga',         '7004'),
 (1222, N'Olutanga',     N'Olutanga',     '7041'),
 (1313, N'Payao',        N'Payao',        '7008'),
 (1429, N'Roseller Lim', N'Reseller Lim', '7002'),
 (1694, N'Siay',         N'Siay',         '7006'),
 (1824, N'Talusan',      N'Talusan',      '7012'),
 (1875, N'Titay',        N'Titay',        '7003'),
 (1913, N'Tungawan',     N'Tungawan',     '7018');

-- Already under Sibugay by name (e.g. added by hand) but with a different code: keep that
-- row, drop the town from the work list so it is never duplicated.
DELETE t FROM @Town t
WHERE EXISTS (SELECT 1 FROM dbo.Municipality m
              WHERE m.ProvinceId = @ZsibId
                AND m.MunicipalityName IN (t.MunicipalityName, t.OldName)
                AND m.MunicipalityCode <> t.MunicipalityCode);

-- Move the misfiled rows out of Zamboanga del Sur, keeping their MunicipalityId.
DECLARE @Moved TABLE (MunicipalityId INT PRIMARY KEY, MunicipalityName NVARCHAR(150));
UPDATE m
   SET m.ProvinceId = @ZsibId, m.MunicipalityName = t.MunicipalityName
OUTPUT inserted.MunicipalityId, inserted.MunicipalityName INTO @Moved
FROM   dbo.Municipality m
       JOIN @Town t ON t.MunicipalityCode = m.MunicipalityCode
WHERE  m.ProvinceId = @ZdsId
  AND  NOT EXISTS (SELECT 1 FROM dbo.Municipality x
                   WHERE x.ProvinceId = @ZsibId AND x.MunicipalityCode = t.MunicipalityCode);

INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues)
SELECT 'Municipality', CAST(mv.MunicipalityId AS NVARCHAR(40)), 'Update',
       CONCAT(N'{"ProvinceId":', @ZdsId, N'}'),
       CONCAT(N'{"ProvinceId":', @ZsibId, N',"MunicipalityName":"', mv.MunicipalityName, N'","Source":"seed 06"}')
FROM   @Moved mv;

-- Rows that pointed at a moved town still say Zamboanga del Sur — correct the province.
UPDATE cr SET cr.ProvinceId = @ZsibId
OUTPUT 'ChapterRegistration', CAST(inserted.RegistrationId AS NVARCHAR(40)), 'Update',
       CONCAT(N'{"ProvinceId":', deleted.ProvinceId, N'}'),
       CONCAT(N'{"ProvinceId":', inserted.ProvinceId, N',"Source":"seed 06"}')
INTO   dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues)
FROM   dbo.ChapterRegistration cr JOIN @Moved mv ON mv.MunicipalityId = cr.MunicipalityId
WHERE  cr.ProvinceId = @ZdsId;

UPDATE c SET c.ProvinceId = @ZsibId
OUTPUT 'Council', CAST(inserted.CouncilId AS NVARCHAR(40)), 'Update',
       CONCAT(N'{"ProvinceId":', deleted.ProvinceId, N'}'),
       CONCAT(N'{"ProvinceId":', inserted.ProvinceId, N',"Source":"seed 06"}')
INTO   dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues)
FROM   dbo.Council c JOIN @Moved mv ON mv.MunicipalityId = c.MunicipalityId
WHERE  c.ProvinceId = @ZdsId;

-- Anything still missing (fresh database) is inserted.
DECLARE @Inserted TABLE (MunicipalityId INT, MunicipalityName NVARCHAR(150));
INSERT dbo.Municipality (ProvinceId, MunicipalityCode, MunicipalityName, ZipCode)
OUTPUT inserted.MunicipalityId, inserted.MunicipalityName INTO @Inserted
SELECT @ZsibId, t.MunicipalityCode, t.MunicipalityName, t.ZipCode
FROM   @Town t
WHERE  NOT EXISTS (SELECT 1 FROM dbo.Municipality m
                   WHERE m.ProvinceId = @ZsibId AND m.MunicipalityCode = t.MunicipalityCode);

INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues)
SELECT 'Municipality', CAST(i.MunicipalityId AS NVARCHAR(40)), 'Insert',
       CONCAT(N'{"ProvinceId":', @ZsibId, N',"MunicipalityName":"', i.MunicipalityName, N'","Source":"seed 06"}')
FROM   @Inserted i;

COMMIT;

-- What it did, for whoever runs this by hand.
SELECT (SELECT COUNT(*) FROM @Moved) AS MovedFromZamboangaDelSur,
       (SELECT COUNT(*) FROM @Inserted) AS Inserted,
       (SELECT COUNT(*) FROM dbo.Municipality WHERE ProvinceId = @ZsibId) AS TotalUnderZamboangaSibugay;

-- Should be empty. A row here is a Sibugay town still listed under Zamboanga del Sur
-- because a same-named row with a different code was already under Sibugay; anything
-- pointing at it needs to be checked by hand before the leftover can be retired.
SELECT  m.MunicipalityId, m.MunicipalityCode, m.MunicipalityName AS StillUnderZamboangaDelSur
FROM    dbo.Municipality m
WHERE   m.ProvinceId = @ZdsId
  AND   m.MunicipalityName IN (N'Alicia', N'Buug', N'Diplahan', N'Imelda', N'Ipil', N'Kabasalan',
            N'Mabuhay', N'Malangas', N'Naga', N'Olutanga', N'Payao', N'Reseller Lim', N'Roseller Lim',
            N'Siay', N'Talusan', N'Titay', N'Tungawan');
