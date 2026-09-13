/* 02 — Members, skills, roles. AIS owns this data; the Portal only reads it. */
IF OBJECT_ID('dbo.MemberStatus') IS NULL
CREATE TABLE dbo.MemberStatus (
    StatusId   INT IDENTITY PRIMARY KEY,
    StatusName NVARCHAR(30) NOT NULL UNIQUE
);
GO
IF OBJECT_ID('dbo.BloodType') IS NULL
CREATE TABLE dbo.BloodType (
    BloodTypeId   INT IDENTITY PRIMARY KEY,
    BloodTypeName NVARCHAR(5) NOT NULL UNIQUE
);
GO
IF OBJECT_ID('dbo.Skill') IS NULL
CREATE TABLE dbo.Skill (
    SkillId   INT IDENTITY PRIMARY KEY,
    SkillName NVARCHAR(60) NOT NULL UNIQUE,
    IsActive  BIT NOT NULL DEFAULT 1     -- controlled list; free text is not permitted
);
GO
IF OBJECT_ID('dbo.Member') IS NULL
CREATE TABLE dbo.Member (
    MemberId        INT IDENTITY PRIMARY KEY,
    /* Home of record. EXACTLY ONE of these is set — see CK_Member_Home below.
       Members are created BY CHAPTERS ONLY: as founding officers on a chapter
       registration, or by signing up and being approved by a Chapter Admin.
       There is no procedure by which a council enrols anybody, and there must
       never be one — a body that enrols its own people is a register nobody can audit.

       HomeCouncilId is therefore a TRANSITION, never a creation path: it is set on a
       member the system already had, when his chapter goes dormant or is dissolved. */
    ChapterId       INT           NULL REFERENCES dbo.Chapter(ChapterId),
    HomeCouncilId   INT           NULL REFERENCES dbo.Council(CouncilId),
    AttachReason    NVARCHAR(200) NULL,   -- required when HomeCouncilId is set (detachment reason)
    AttachedSince   DATE          NULL,
    AttachReviewedOn DATE         NULL,   -- annual review; attachment is never permanent
    ChapterOfRecord NVARCHAR(150) NULL,   -- historical name when no ChapterId exists
    MemberNumber    NVARCHAR(30)  NOT NULL UNIQUE,   -- AKR-RR-CCCC-NNN
    FirstName       NVARCHAR(80)  NOT NULL,
    MiddleName      NVARCHAR(80)  NULL,
    LastName        NVARCHAR(80)  NOT NULL,
    GiftName        NVARCHAR(60)  NOT NULL,
    Birthdate       DATE          NULL,
    Address         NVARCHAR(250) NULL,
    BloodTypeId     INT           NULL REFERENCES dbo.BloodType(BloodTypeId),
    Profession      NVARCHAR(100) NULL,
    PhotoPath       NVARCHAR(400) NULL,
    DateSurvive     DATE          NULL,
    PresidentDuringSurvive     NVARCHAR(120) NULL,
    MasterInitiatorDuringSurvive NVARCHAR(120) NULL,
    MobileNo        NVARCHAR(30)  NULL,
    Email           NVARCHAR(150) NULL,
    StatusId        INT           NOT NULL REFERENCES dbo.MemberStatus(StatusId),
    RenewedThrough  DATE          NULL,    -- always an 8 August date
    SeconderMemberId INT          NULL REFERENCES dbo.Member(MemberId),
    SeconderConfirmedDate DATETIME2 NULL,
    ApprovedBy      INT           NULL,
    ApprovedDate    DATETIME2     NULL,
    IsDeleted       BIT           NOT NULL DEFAULT 0,
    CreatedDate     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    RowVersion      ROWVERSION,
    /* A member belongs to a chapter OR to a council. Never both, never neither —
       a member with no home cannot be scoped, cannot renew, and cannot be audited. */
    CONSTRAINT CK_Member_Home CHECK (
        (ChapterId IS NOT NULL AND HomeCouncilId IS NULL)
     OR (ChapterId IS NULL     AND HomeCouncilId IS NOT NULL AND AttachReason IS NOT NULL)
    )
);
GO
IF OBJECT_ID('dbo.MemberSkill') IS NULL
CREATE TABLE dbo.MemberSkill (
    MemberId INT NOT NULL REFERENCES dbo.Member(MemberId),
    SkillId  INT NOT NULL REFERENCES dbo.Skill(SkillId),
    PRIMARY KEY (MemberId, SkillId)
);
GO
IF OBJECT_ID('dbo.Role') IS NULL
CREATE TABLE dbo.Role (
    RoleId   INT IDENTITY PRIMARY KEY,
    RoleName NVARCHAR(60) NOT NULL UNIQUE,
    IsCouncilRole BIT NOT NULL DEFAULT 0
);
GO
/* Roles are scoped assignments with a term, never columns on Member. */
IF OBJECT_ID('dbo.MemberRole') IS NULL
CREATE TABLE dbo.MemberRole (
    MemberRoleId INT IDENTITY PRIMARY KEY,
    MemberId  INT NOT NULL REFERENCES dbo.Member(MemberId),
    RoleId    INT NOT NULL REFERENCES dbo.Role(RoleId),
    ScopeType NVARCHAR(20) NOT NULL,        -- 'Chapter' | 'Council' | 'Global'
    ScopeId   INT NULL,
    TermStart DATE NOT NULL,
    TermEnd   DATE NULL,                    -- null = open term
    CONSTRAINT CK_MemberRole_Scope CHECK (ScopeType IN ('Chapter','Council','Global'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Member_Chapter_Status')
    CREATE INDEX IX_Member_Chapter_Status ON dbo.Member(ChapterId, StatusId) WHERE IsDeleted = 0;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Member_BloodType')
    CREATE INDEX IX_Member_BloodType ON dbo.Member(BloodTypeId) WHERE IsDeleted = 0;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_MemberSkill_Skill')
    CREATE INDEX IX_MemberSkill_Skill ON dbo.MemberSkill(SkillId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Member_HomeCouncil')
    CREATE INDEX IX_Member_HomeCouncil ON dbo.Member(HomeCouncilId)
        WHERE HomeCouncilId IS NOT NULL AND IsDeleted = 0;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_MemberRole_Member')
    CREATE INDEX IX_MemberRole_Member ON dbo.MemberRole(MemberId, ScopeType, ScopeId);
GO
