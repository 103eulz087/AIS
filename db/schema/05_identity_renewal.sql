/* 05 — QR credentials, scan log, and the Central Portal renewal module. */
IF OBJECT_ID('dbo.MemberCredential') IS NULL
CREATE TABLE dbo.MemberCredential (
    CredentialId  INT IDENTITY PRIMARY KEY,
    MemberId      INT NOT NULL REFERENCES dbo.Member(MemberId),
    /* TokenSubject is opaque and is what goes in the QR.
       The MemberId itself must NEVER appear in a token payload. */
    TokenSubject  UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() UNIQUE,
    IssuedDate    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiryDate    DATETIME2 NOT NULL,
    RevokedDate   DATETIME2 NULL,
    RevokedBy     INT NULL,
    PublicKeyVersion INT NOT NULL DEFAULT 1
);
GO
/* At most one un-revoked row per member, enforced by the database, not just by the
   issuing procs' own UPDLOCK/HOLDLOCK checks (which only protect against two concurrent
   issuances racing each other — nothing previously stopped some OTHER future write path
   from adding a second live-looking row outright). A plain filtered index on
   "RevokedDate IS NULL AND ExpiryDate > SYSUTCDATETIME()" is not possible here — SQL
   Server filtered index predicates must be deterministic and cannot reference
   SYSUTCDATETIME() — so the rule this enforces is "not yet revoked", not "not yet
   revoked and not yet expired". That is exactly why usp_Credential_GetOrIssueForSelf and
   usp_Credential_BulkIssueForExport both explicitly REVOKE a stale (expired but
   never-revoked) row the moment they are about to issue a replacement, rather than
   leaving it sitting at RevokedDate IS NULL indefinitely — "not yet revoked" and "the
   member's one current credential" must always mean the same thing for this index to
   hold, and until that change those two things had quietly drifted apart. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MemberCredential_Member_Live')
    CREATE UNIQUE INDEX UX_MemberCredential_Member_Live
        ON dbo.MemberCredential(MemberId) WHERE RevokedDate IS NULL;
GO
/* Scan logging is two-way: the scanned member can see who verified his card. */
IF OBJECT_ID('dbo.ScanLog') IS NULL
CREATE TABLE dbo.ScanLog (
    ScanId       INT IDENTITY PRIMARY KEY,
    CredentialId INT NULL REFERENCES dbo.MemberCredential(CredentialId),
    ScannedByMemberId INT NULL REFERENCES dbo.Member(MemberId),
    ScanDate     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ResultCode   NVARCHAR(20) NOT NULL,    -- Live|Offline|Invalid|Revoked|Expired
    WasOffline   BIT NOT NULL DEFAULT 0,
    MeetingId    INT NULL REFERENCES dbo.Meeting(MeetingId),
    DeviceHint   NVARCHAR(120) NULL
);
GO
/* Every organizational approval is routed to the NEAREST EXISTING ANCESTOR.
   During bootstrap and expansion the immediate parent may not exist yet; during
   dormancy it exists but has nobody seated. One rule covers both, plus delay override.
   This table records which body actually acted and why it was not the parent. */
IF OBJECT_ID('dbo.ApprovalRouting') IS NULL
CREATE TABLE dbo.ApprovalRouting (
    RoutingId       INT IDENTITY PRIMARY KEY,
    SubjectType     NVARCHAR(20) NOT NULL,   -- Chapter | Council | Renewal
    SubjectId       INT NOT NULL,
    IntendedCouncilId INT NULL REFERENCES dbo.Council(CouncilId),  -- null = did not exist
    ActingCouncilId INT NOT NULL REFERENCES dbo.Council(CouncilId),
    RoutingReason   NVARCHAR(40) NOT NULL,   -- Parent | ParentDoesNotExist | ParentDormant | Override
    ActorMemberId   INT NULL REFERENCES dbo.Member(MemberId),
    ActedOn         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Remarks         NVARCHAR(400) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_ApprovalRouting_Subject')
    CREATE INDEX IX_ApprovalRouting_Subject ON dbo.ApprovalRouting(SubjectType, SubjectId);
GO

/* A council officer must be a member of a chapter inside that council's jurisdiction.
   Seating someone from outside is allowed — a province with one chapter cannot supply
   six officers otherwise — but it is never silent. No waiver, no approval step:
   just a permanent record of who did it and why. */
IF OBJECT_ID('dbo.SeatOverride') IS NULL
CREATE TABLE dbo.SeatOverride (
    SeatOverrideId INT IDENTITY PRIMARY KEY,
    MemberRoleId   INT NOT NULL REFERENCES dbo.MemberRole(MemberRoleId),
    CouncilId      INT NOT NULL REFERENCES dbo.Council(CouncilId),
    MemberId       INT NOT NULL REFERENCES dbo.Member(MemberId),
    HomeChapterId  INT NULL REFERENCES dbo.Chapter(ChapterId),
    SeatedBy       INT NOT NULL REFERENCES dbo.Member(MemberId),
    SeatedOn       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Reason         NVARCHAR(300) NOT NULL
);
GO

/* The installer's organizational authority ends the moment the National Council seats
   a president. It is a consequence of that seating, not an action he takes — and it is
   one-way. Break-glass is two-person and time-boxed; see usp_SystemAdmin_BreakGlass. */
IF OBJECT_ID('dbo.AuthorityHandover') IS NULL
CREATE TABLE dbo.AuthorityHandover (
    HandoverId    INT IDENTITY PRIMARY KEY,
    HandedOverOn  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    TriggeredByMemberRoleId INT NULL REFERENCES dbo.MemberRole(MemberRoleId),
    Notes         NVARCHAR(300) NULL
);
GO
IF OBJECT_ID('dbo.BreakGlassSession') IS NULL
CREATE TABLE dbo.BreakGlassSession (
    SessionId     INT IDENTITY PRIMARY KEY,
    OpenedOn      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresOn     DATETIME2 NOT NULL,       -- always OpenedOn + 72 hours
    SecondApproverMemberId INT NOT NULL REFERENCES dbo.Member(MemberId),
    Reason        NVARCHAR(400) NOT NULL,
    AnnouncedOn   DATETIME2 NULL,           -- every council officer is told, immediately
    ClosedOn      DATETIME2 NULL
);
GO
IF OBJECT_ID('dbo.RenewalPeriod') IS NULL
CREATE TABLE dbo.RenewalPeriod (
    PeriodId        INT IDENTITY PRIMARY KEY,
    [Year]          INT NOT NULL UNIQUE,   -- named by the year the membership year OPENS
    OpensDate       DATE NOT NULL,
    ClosesDate      DATE NOT NULL,         -- 08 August
    GraceEndsDate   DATE NOT NULL,
    FeePerMember    DECIMAL(18,2) NOT NULL,
    LateFeePerMember DECIMAL(18,2) NOT NULL DEFAULT 0,
    CityWindowDays  INT NOT NULL DEFAULT 10,   -- working days
    ProvinceArmsDay INT NOT NULL DEFAULT 10,
    RegionArmsDay   INT NOT NULL DEFAULT 20,
    IsOpen          BIT NOT NULL DEFAULT 0,
    ConfiguredBy    INT NULL
);
GO
IF OBJECT_ID('dbo.FeeSplit') IS NULL
CREATE TABLE dbo.FeeSplit (
    FeeSplitId     INT IDENTITY PRIMARY KEY,
    PeriodId       INT NOT NULL REFERENCES dbo.RenewalPeriod(PeriodId),
    CouncilLevelId INT NOT NULL REFERENCES dbo.CouncilLevel(CouncilLevelId),
    SharePercent   DECIMAL(5,2) NOT NULL,
    PurposeText    NVARCHAR(300) NOT NULL,  -- shown to members, not just the percentage
    CONSTRAINT UQ_FeeSplit UNIQUE (PeriodId, CouncilLevelId)
);
GO
IF OBJECT_ID('dbo.PublicHoliday') IS NULL
CREATE TABLE dbo.PublicHoliday (
    HolidayDate DATE PRIMARY KEY,
    HolidayName NVARCHAR(120) NOT NULL
);
GO
IF OBJECT_ID('dbo.ChapterRenewal') IS NULL
CREATE TABLE dbo.ChapterRenewal (
    RenewalId    INT IDENTITY PRIMARY KEY,
    ReferenceNo  NVARCHAR(30) NOT NULL UNIQUE,
    ChapterId    INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    PeriodId     INT NOT NULL REFERENCES dbo.RenewalPeriod(PeriodId),
    SubmittedBy  INT NULL,
    SubmittedDate DATETIME2 NULL,
    MemberCount  INT NOT NULL DEFAULT 0,
    TotalFee     DECIMAL(18,2) NOT NULL DEFAULT 0,
    StatusName   NVARCHAR(30) NOT NULL,   -- Draft|Submitted|Returned|Approved
    ApprovedByCouncilId INT NULL REFERENCES dbo.Council(CouncilId),
    ApprovedByMemberId  INT NULL REFERENCES dbo.Member(MemberId),
    ApprovedDate DATETIME2 NULL,
    IsOverride   BIT NOT NULL DEFAULT 0,
    OverriddenCouncilId INT NULL REFERENCES dbo.Council(CouncilId),
    OverrideReason NVARCHAR(120) NULL,
    OverrideRemarks NVARCHAR(600) NULL,
    RowVersion   ROWVERSION
);
GO
/* One live application per chapter per period. Guards double submission. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_Renewal_Chapter_Period')
    CREATE UNIQUE INDEX UQ_Renewal_Chapter_Period ON dbo.ChapterRenewal(ChapterId, PeriodId)
        WHERE StatusName <> 'Returned';
GO
IF OBJECT_ID('dbo.MemberRenewal') IS NULL
CREATE TABLE dbo.MemberRenewal (
    MemberRenewalId INT IDENTITY PRIMARY KEY,
    RenewalId  INT NOT NULL REFERENCES dbo.ChapterRenewal(RenewalId),
    MemberId   INT NOT NULL REFERENCES dbo.Member(MemberId),
    /* Renewed | Lapsed | Exempt.  Lapsed is NOT a disciplinary state. */
    RenewalStatus NVARCHAR(10) NOT NULL,
    FeeAmount  DECIMAL(18,2) NOT NULL DEFAULT 0,
    RenewedThrough DATE NULL,
    CONSTRAINT UQ_MemberRenewal UNIQUE (RenewalId, MemberId),
    CONSTRAINT CK_MemberRenewal_Status CHECK (RenewalStatus IN ('Renewed','Lapsed','Exempt'))
);
GO
IF OBJECT_ID('dbo.RenewalAction') IS NULL
CREATE TABLE dbo.RenewalAction (
    ActionId   INT IDENTITY PRIMARY KEY,
    RenewalId  INT NOT NULL REFERENCES dbo.ChapterRenewal(RenewalId),
    CouncilId  INT NULL REFERENCES dbo.Council(CouncilId),
    ActorMemberId INT NULL REFERENCES dbo.Member(MemberId),
    ActionType NVARCHAR(20) NOT NULL,   -- Submit|Return|Remind|Approve|Override
    ActionDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Remarks    NVARCHAR(600) NULL
);
GO
IF OBJECT_ID('dbo.RenewalPayment') IS NULL
CREATE TABLE dbo.RenewalPayment (
    PaymentId  INT IDENTITY PRIMARY KEY,
    RenewalId  INT NOT NULL REFERENCES dbo.ChapterRenewal(RenewalId),
    ORNumber   NVARCHAR(40) NOT NULL,
    PaidDate   DATE NOT NULL,
    Amount     DECIMAL(18,2) NOT NULL,
    ReceivedBy INT NOT NULL,
    ScanPath   NVARCHAR(400) NULL,
    PostedBy   INT NOT NULL,
    PostedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
/* Acknowledgement receipt: one per application. Numbers are NEVER reused. */
IF OBJECT_ID('dbo.AckReceipt') IS NULL
CREATE TABLE dbo.AckReceipt (
    AckReceiptId INT IDENTITY PRIMARY KEY,
    ARNumber     NVARCHAR(30) NOT NULL UNIQUE,
    RenewalId    INT NOT NULL REFERENCES dbo.ChapterRenewal(RenewalId),
    IssuedByCouncilId INT NOT NULL REFERENCES dbo.Council(CouncilId),
    IssuedByMemberId  INT NOT NULL REFERENCES dbo.Member(MemberId),
    IssuedDate   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Amount       DECIMAL(18,2) NOT NULL,
    AmountInWords NVARCHAR(300) NOT NULL,
    VerificationCode NVARCHAR(20) NOT NULL,
    IsVoided     BIT NOT NULL DEFAULT 0,
    VoidReason   NVARCHAR(400) NULL,
    VoidedBy     INT NULL,
    VoidedDate   DATETIME2 NULL
);
GO
CREATE OR ALTER TRIGGER dbo.TR_AckReceipt_NoDelete
ON dbo.AckReceipt INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51003, 'Receipts are never deleted. Void the receipt instead; the number is retired.', 1;
END
GO
IF OBJECT_ID('dbo.MemberSeal') IS NULL
CREATE TABLE dbo.MemberSeal (
    SealId    INT IDENTITY PRIMARY KEY,
    MemberId  INT NOT NULL REFERENCES dbo.Member(MemberId),
    [Year]    INT NOT NULL,
    SealType  NVARCHAR(20) NOT NULL DEFAULT 'YearSeal',  -- YearSeal|Milestone10|...
    IssuedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    RenewalId INT NULL REFERENCES dbo.ChapterRenewal(RenewalId),
    CONSTRAINT UQ_MemberSeal UNIQUE (MemberId, [Year], SealType)
);
GO
IF OBJECT_ID('dbo.AuditLog') IS NULL
CREATE TABLE dbo.AuditLog (
    AuditId     BIGINT IDENTITY PRIMARY KEY,
    TableName   NVARCHAR(80) NOT NULL,
    RecordId    NVARCHAR(40) NULL,
    [Action]    NVARCHAR(20) NOT NULL,
    OldValues   NVARCHAR(MAX) NULL,
    NewValues   NVARCHAR(MAX) NULL,
    PerformedBy INT NULL,
    PerformedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    IpAddress   NVARCHAR(45) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Audit_Date')
    CREATE INDEX IX_Audit_Date ON dbo.AuditLog(PerformedDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Renewal_Period_Status')
    CREATE INDEX IX_Renewal_Period_Status ON dbo.ChapterRenewal(PeriodId, StatusName);
GO
