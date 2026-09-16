/* 16 — Philippine geography reference data (Region -> Province -> Municipality/City).
   Feeds the cascading location picker on the chapter/council registration module (a later
   module — docs/AIS-Project-Documentation.md §4.1, §7A); Chapter.Barangay and
   Council.CouncilName stay free text until that module is built and actually references
   these by foreign key. Pure reference data: no scoping, nothing sensitive (CLAUDE.md
   invariant #7 is about MEMBER data, not public geography).

   Values migrated from a commercial PH geography dataset the client already had loaded into
   this database (Regions/Provinces/Municipalities, filtered to COUNTRY_CODE='63' — that
   dataset covers many countries; those raw staging tables are not part of this schema and
   may be dropped once db/seed/05_ph_geography.sql has been run). RegionCode/ProvinceCode/
   MunicipalityCode below are that source's own numeric codes, kept as natural keys so a
   re-run of the seed script (or a future re-import) never duplicates a row. */
IF OBJECT_ID('dbo.Region') IS NULL
CREATE TABLE dbo.Region (
    RegionId    INT IDENTITY PRIMARY KEY,
    RegionCode  CHAR(2)       NOT NULL UNIQUE,
    RegionName  NVARCHAR(100) NOT NULL
);
GO
IF OBJECT_ID('dbo.Province') IS NULL
CREATE TABLE dbo.Province (
    ProvinceId   INT IDENTITY PRIMARY KEY,
    RegionId     INT           NOT NULL REFERENCES dbo.Region(RegionId),
    ProvinceCode SMALLINT      NOT NULL UNIQUE,
    ProvinceName NVARCHAR(150) NOT NULL
);
GO
IF OBJECT_ID('dbo.Municipality') IS NULL
CREATE TABLE dbo.Municipality (
    MunicipalityId   INT IDENTITY PRIMARY KEY,
    ProvinceId       INT           NOT NULL REFERENCES dbo.Province(ProvinceId),
    MunicipalityCode SMALLINT      NOT NULL,
    MunicipalityName NVARCHAR(150) NOT NULL,
    ZipCode          VARCHAR(10)   NULL,
    CONSTRAINT UQ_Municipality_ProvinceCode UNIQUE (ProvinceId, MunicipalityCode)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Province_Region')
    CREATE INDEX IX_Province_Region ON dbo.Province(RegionId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Municipality_Province')
    CREATE INDEX IX_Municipality_Province ON dbo.Municipality(ProvinceId);
GO
