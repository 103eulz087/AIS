/* 01 — Organization hierarchy. Councils are a self-referencing tree. */
IF OBJECT_ID('dbo.CouncilLevel') IS NULL
CREATE TABLE dbo.CouncilLevel (
    CouncilLevelId  INT IDENTITY PRIMARY KEY,
    LevelName       NVARCHAR(50)  NOT NULL UNIQUE,
    LevelOrder      INT           NOT NULL
);
GO
IF OBJECT_ID('dbo.Council') IS NULL
CREATE TABLE dbo.Council (
    CouncilId       INT IDENTITY PRIMARY KEY,
    ParentCouncilId INT           NULL REFERENCES dbo.Council(CouncilId),
    CouncilLevelId  INT           NOT NULL REFERENCES dbo.CouncilLevel(CouncilLevelId),
    CouncilName     NVARCHAR(150) NOT NULL,
    CountryCode     CHAR(2)       NOT NULL DEFAULT 'PH',
    IsActive        BIT           NOT NULL DEFAULT 1,
    RowVersion      ROWVERSION
);
GO
IF OBJECT_ID('dbo.Chapter') IS NULL
CREATE TABLE dbo.Chapter (
    ChapterId       INT IDENTITY PRIMARY KEY,
    ParentCouncilId INT           NOT NULL REFERENCES dbo.Council(CouncilId),
    ChapterName     NVARCHAR(150) NOT NULL,
    Barangay        NVARCHAR(100) NULL,
    DateChartered   DATE          NULL,
    -- per-chapter settings (client decision: chapters configure their own)
    SuggestedContribution DECIMAL(18,2) NOT NULL DEFAULT 0,
    ChatRetentionMonths   INT           NOT NULL DEFAULT 12,
    IsActive        BIT           NOT NULL DEFAULT 1,
    RowVersion      ROWVERSION
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Council_Parent')
    CREATE INDEX IX_Council_Parent ON dbo.Council(ParentCouncilId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Chapter_Council')
    CREATE INDEX IX_Chapter_Council ON dbo.Chapter(ParentCouncilId);
GO
