/* 17 — Chapter registration: charter (a brand-new chapter) and officer turnover (the
   identical form filed again, each August, against a chapter that already exists).
   docs/AIS-Project-Documentation.md §7A.4, CLAUDE.md invariants #1, #4, #12, #13, #15, #16.

   Three things this file deliberately does NOT do, because the invariants forbid them:

   1. NO LedgerEntry row at charter. dbo.LedgerEntry has CHECK (Amount > 0) and is
      append-only (invariant #1) — a new chapter's zero balance is zero because nothing
      was ever posted, not because a zero-amount opening entry was inserted (which the
      CHECK constraint would reject anyway).
   2. NO new dbo.RenewalPeriod / dbo.ChapterRenewal row at charter. RenewalPeriod is ONE
      NATIONAL row per year (§7A.5: "a council inherits, it does not configure") — a
      chapter does not get its own. Chapter.CharteredUnderYear (below) records which
      membership year the chapter opened under; that is all a charter needs to say about
      renewal until the chapter's first real renewal season.
   3. NO ChapterAuditor write access anywhere. The role exists (seeded below) purely so
      the Auditor office has something to grant; policy wiring (backend, next step) must
      never place ChapterAuditor in a write-granting policy. Noted here so a future
      reader of this schema file sees the constraint even before reading the API layer.

   ============================================================================
   1. COUNCIL JURISDICTION — usp_Council_ResolveJurisdiction (db/procs/) matches a
      charter application's Region/Province/Municipality against these columns to find
      the intended approving council. National keeps all three NULL (it has no
      geography of its own — it IS the top). A City/Municipal council sets MunicipalityId
      only; a Provincial council sets ProvinceId only; a Regional council sets RegionId
      only. Existing councils are NOT backfilled here — that is a separate, future,
      one-time data-entry script, out of scope for this module.
   ============================================================================ */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Council') AND name = 'RegionId')
    ALTER TABLE dbo.Council ADD RegionId INT NULL REFERENCES dbo.Region(RegionId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Council') AND name = 'ProvinceId')
    ALTER TABLE dbo.Council ADD ProvinceId INT NULL REFERENCES dbo.Province(ProvinceId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Council') AND name = 'MunicipalityId')
    ALTER TABLE dbo.Council ADD MunicipalityId INT NULL REFERENCES dbo.Municipality(MunicipalityId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Council_Municipality')
    CREATE INDEX IX_Council_Municipality ON dbo.Council(MunicipalityId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Council_Province')
    CREATE INDEX IX_Council_Province ON dbo.Council(ProvinceId);
GO

/* ============================================================================
   2. OFFICE AS A FIRST-CLASS, DATED THING.

   Why an office is a ROW, not a hardcoded id or a column on MemberRole: eight offices
   are named in the paper form (§7A.4) and each maps to a system role EXCEPT the three
   Master Initiator seats, which grant no login at all — dbo.ChapterOffice.GrantsLogin
   records that distinction so a proc can ask "does this office get an enrolment link?"
   without a CASE on OfficeName sprinkled through every caller.

   WHY EVERY OFFICER GETS TWO MemberRole ROWS, NOT ONE. A plain 'Member' role never
   closes — a man who steps down as Treasurer is still a member. An office role IS dated
   and DOES close at turnover. Folding both into one row would force a choice: either
   turnover closes the man's membership too (wrong — invariant #13's whole point is that
   members persist), or the plain membership never gets its own row and "is this person
   currently a member of this chapter at all" has no clean answer once he no longer holds
   any office. Two rows say exactly two true things separately:
     - MemberRole (RoleId='Member', OfficeId NULL, TermStart=DateSurvive-ish, TermEnd=NULL)
       — he is a member of this chapter, full stop, forever (until deleted, which never
       happens either).
     - MemberRole (RoleId=<office's role>, OfficeId=<the office>, TermStart, TermEnd)
       — he held THIS OFFICE for THIS TERM. Turnover sets TermEnd on this row and this
       row alone; the plain Member row above is never touched by a turnover proc.
   usp_Auth_GetClaims (db/procs/) already returns one row per currently-active MemberRole
   via a LEFT JOIN with no assumption of at-most-one-role-per-member, so a chapter
   admin who is also (structurely impossible today, but the shape allows it) recorded
   with two simultaneously active roles already returns two rows today for any member who
   somehow already had two overlapping roles before this file — this file does not change
   that proc and does not need to; it simply becomes the first case that actually produces
   two rows for the SAME TermStart on any real data (a freshly-charter member gets his
   plain-Member row and his office row inserted together, same day). That is additive,
   not a behavior change to the proc itself — confirmed by reading it: no assumption
   there breaks on the extra row. */
IF OBJECT_ID('dbo.ChapterOffice') IS NULL
CREATE TABLE dbo.ChapterOffice (
    OfficeId    INT IDENTITY PRIMARY KEY,
    OfficeName  NVARCHAR(60) NOT NULL UNIQUE,
    SortOrder   INT NOT NULL,
    RoleId      INT NULL REFERENCES dbo.Role(RoleId),
    GrantsLogin BIT NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MemberRole') AND name = 'OfficeId')
    ALTER TABLE dbo.MemberRole ADD OfficeId INT NULL REFERENCES dbo.ChapterOffice(OfficeId);
GO

/* ============================================================================
   3. REGISTRATION TABLES. Shape modeled directly on db/schema/10_membership_applications.sql
      — read that file's own header first, its idioms are reused wholesale here:
        - IsOpen is a MAINTAINED bit, never a baked-in StatusId literal in a filtered
          index predicate (status ids are seeded surrogate keys and must never be
          hardcoded into permanent DDL).
        - *Update is an append-only history table. No update/delete procedure for it
          exists and none should ever be added.
        - The reference-number sequence is caught-and-returned on a duplicate-key error
          from usp_ChapterRegistration_Submit / _SubmitTurnover, exactly like
          usp_MembershipApplication_Submit already does.
   ============================================================================ */

/* Submitted -> ReturnedForCorrection -> Approved. EXACTLY these three rows, forever.
   No 'Rejected' row may ever be added here — §7A.4: "rejection is not an available
   action — a chapter that has organized and petitioned must always have a route
   forward." A chapter application does not die; it is returned for correction until
   it is approved. (Contrast dbo.MembershipApplicationStatus, which DOES have a
   Rejected row — that is a different lifecycle, for an individual sign-up, and this
   file must not be read as inconsistent with it: the "always a route forward" rule is
   specific to a chapter that has organized and petitioned, per §7A.4, not to every
   application in this system.) */
IF OBJECT_ID('dbo.ChapterRegistrationStatus') IS NULL
CREATE TABLE dbo.ChapterRegistrationStatus (
    StatusId   INT IDENTITY PRIMARY KEY,
    StatusName NVARCHAR(30) NOT NULL UNIQUE
);
GO

/* dbo.ChapterAccent — the six-colour approved palette (§7A.3). Free colour choice is
   explicitly forbidden by the spec ("not a colour picker"); this table IS the fixed
   list backing that constraint. Hex values reuse this app's own existing design tokens
   (src/web/src/shared/tokens.css) where a plausible named match exists, so a chapter's
   accent never clashes with the app chrome around it. */
IF OBJECT_ID('dbo.ChapterAccent') IS NULL
CREATE TABLE dbo.ChapterAccent (
    AccentId   INT IDENTITY PRIMARY KEY,
    AccentName NVARCHAR(30) NOT NULL UNIQUE,
    HexValue   CHAR(7) NOT NULL
);
GO

/* dbo.ChapterRegistration — one row per filing, Charter OR Turnover.
   RegistrationType drives which columns are populated; CK_ChapterRegistration_Type
   enforces the split mechanically rather than trusting the caller:
     - Charter:  ChapterId NULL (it doesn't exist yet), ProposedChapterName + the three
                 geography columns ARE set (this IS the location), SubmittedByMemberId
                 NULL (no account exists yet — the form is public and unauthenticated).
     - Turnover: ChapterId set (the existing chapter), ProposedChapterName + the three
                 geography columns NULL (a turnover never relocates a chapter — location
                 doesn't change), SubmittedByMemberId set (filed authenticated, by the
                 chapter's own sitting ChapterAdmin — decision E1a).
   IntendedCouncilId / ActingCouncilId / RoutingReason mirror dbo.ApprovalRouting's own
   three columns of the same names/purpose (see db/schema/05_identity_renewal.sql) —
   this table additionally carries its own copy so a reader of ONE row here never needs
   a join to ApprovalRouting just to see who is deciding it; the ApprovalRouting row
   itself is still written too (task 7/8), as the durable, cross-subject-type ledger of
   every routed approval in the system. */
IF OBJECT_ID('dbo.ChapterRegistration') IS NULL
CREATE TABLE dbo.ChapterRegistration (
    RegistrationId       INT IDENTITY PRIMARY KEY,
    ReferenceNo          NVARCHAR(20)  NOT NULL UNIQUE,
    RegistrationType     NVARCHAR(10)  NOT NULL,
    ChapterId            INT           NULL REFERENCES dbo.Chapter(ChapterId),
    ProposedChapterName  NVARCHAR(150) NULL,
    Barangay             NVARCHAR(100) NULL,
    RegionId             INT           NULL REFERENCES dbo.Region(RegionId),
    ProvinceId           INT           NULL REFERENCES dbo.Province(ProvinceId),
    MunicipalityId       INT           NULL REFERENCES dbo.Municipality(MunicipalityId),
    MarkAccentId         INT           NULL REFERENCES dbo.ChapterAccent(AccentId),
    IntendedCouncilId    INT           NULL REFERENCES dbo.Council(CouncilId),
    ActingCouncilId      INT           NOT NULL REFERENCES dbo.Council(CouncilId),
    RoutingReason        NVARCHAR(40)  NOT NULL,
    SubmittedByMemberId  INT           NULL REFERENCES dbo.Member(MemberId),
    SubmittedDate        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    StatusId             INT           NOT NULL REFERENCES dbo.ChapterRegistrationStatus(StatusId),
    IsOpen                BIT          NOT NULL DEFAULT 1,
    DecidedBy            INT           NULL REFERENCES dbo.Member(MemberId),
    DecidedDate          DATETIME2     NULL,
    DecisionReason       NVARCHAR(500) NULL,
    CreatedChapterId     INT           NULL REFERENCES dbo.Chapter(ChapterId),
    RowVersion           ROWVERSION,
    CONSTRAINT CK_ChapterRegistration_RegistrationType CHECK (RegistrationType IN ('Charter','Turnover')),
    CONSTRAINT CK_ChapterRegistration_Type CHECK (
        (RegistrationType = 'Charter'  AND ChapterId IS NULL     AND ProposedChapterName IS NOT NULL
                                        AND RegionId IS NOT NULL AND ProvinceId IS NOT NULL AND MunicipalityId IS NOT NULL
                                        AND SubmittedByMemberId IS NULL)
     OR (RegistrationType = 'Turnover' AND ChapterId IS NOT NULL AND ProposedChapterName IS NULL
                                        AND RegionId IS NULL     AND ProvinceId IS NULL     AND MunicipalityId IS NULL
                                        AND SubmittedByMemberId IS NOT NULL)
    )
);
GO

/* One open registration per chapter, for Turnover rows (a chapter cannot have two
   competing officer-turnover forms in flight at once). ChapterId is NULL for every
   Charter row, and SQL Server unique indexes treat each NULL as distinct, so this does
   not also need a RegistrationType filter to be correct — it is added anyway, for a
   reader's clarity about intent. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ChapterRegistration_OpenTurnover')
    CREATE UNIQUE INDEX UX_ChapterRegistration_OpenTurnover
        ON dbo.ChapterRegistration(ChapterId) WHERE IsOpen = 1 AND RegistrationType = 'Turnover';
GO

/* One open registration per (municipality, proposed name), for Charter rows — the
   server-side double-submit guard, same idiom as UX_MembershipApplication_Open. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ChapterRegistration_OpenCharter')
    CREATE UNIQUE INDEX UX_ChapterRegistration_OpenCharter
        ON dbo.ChapterRegistration(MunicipalityId, ProposedChapterName) WHERE IsOpen = 1 AND RegistrationType = 'Charter';
GO

/* The council's own queue: registrations it is currently acting on, newest first. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChapterRegistration_ActingCouncil_Status')
    CREATE INDEX IX_ChapterRegistration_ActingCouncil_Status
        ON dbo.ChapterRegistration(ActingCouncilId, StatusId, SubmittedDate DESC);
GO

/* dbo.ChapterRegistrationOfficer — the eight seats, one row each, per registration.
   CK_ChapterRegistrationOfficer_Person is the mechanical version of "Charter: typed in;
   Turnover: selected from the roster" — exactly one of (MemberId set) or (the three
   identity fields FirstName+LastName+GiftName all set), never both, never neither. */
IF OBJECT_ID('dbo.ChapterRegistrationOfficer') IS NULL
CREATE TABLE dbo.ChapterRegistrationOfficer (
    RegistrationOfficerId INT IDENTITY PRIMARY KEY,
    RegistrationId    INT NOT NULL REFERENCES dbo.ChapterRegistration(RegistrationId),
    OfficeId          INT NOT NULL REFERENCES dbo.ChapterOffice(OfficeId),
    MemberId          INT NULL REFERENCES dbo.Member(MemberId),
    FirstName         NVARCHAR(80)  NULL,
    MiddleName        NVARCHAR(80)  NULL,
    LastName          NVARCHAR(80)  NULL,
    GiftName          NVARCHAR(60)  NULL,
    BirthDate         DATE          NULL,
    MobileNo          NVARCHAR(30)  NULL,
    Email             NVARCHAR(150) NULL,
    DateSurvive       DATE          NULL,
    PresidentDuringSurvive       NVARCHAR(120) NULL,
    MasterInitiatorDuringSurvive NVARCHAR(120) NULL,
    VerifiedBy        INT NULL REFERENCES dbo.Member(MemberId),
    VerifiedDate      DATETIME2 NULL,
    VerifyNote        NVARCHAR(300) NULL,
    CreatedMemberId   INT NULL REFERENCES dbo.Member(MemberId),
    CONSTRAINT UQ_ChapterRegistrationOfficer UNIQUE (RegistrationId, OfficeId),
    CONSTRAINT CK_ChapterRegistrationOfficer_Person CHECK (
        (MemberId IS NOT NULL AND FirstName IS NULL     AND LastName IS NULL     AND GiftName IS NULL)
     OR (MemberId IS NULL     AND FirstName IS NOT NULL AND LastName IS NOT NULL AND GiftName IS NOT NULL)
    )
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChapterRegistrationOfficer_Member')
    CREATE INDEX IX_ChapterRegistrationOfficer_Member ON dbo.ChapterRegistrationOfficer(MemberId) WHERE MemberId IS NOT NULL;
GO

/* dbo.ChapterRegistrationUpdate — append-only status history. Same shape as
   dbo.MembershipApplicationUpdate; no update/delete procedure exists for this table
   and none should ever be added. */
IF OBJECT_ID('dbo.ChapterRegistrationUpdate') IS NULL
CREATE TABLE dbo.ChapterRegistrationUpdate (
    ChapterRegistrationUpdateId INT IDENTITY PRIMARY KEY,
    RegistrationId INT NOT NULL REFERENCES dbo.ChapterRegistration(RegistrationId),
    UpdateDate     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT NULL REFERENCES dbo.Member(MemberId),
    StatusId       INT NOT NULL REFERENCES dbo.ChapterRegistrationStatus(StatusId),
    Notes          NVARCHAR(500) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChapterRegistrationUpdate_Registration')
    CREATE INDEX IX_ChapterRegistrationUpdate_Registration ON dbo.ChapterRegistrationUpdate(RegistrationId, UpdateDate);
GO

/* ---- Sequences.

   dbo.ChapterRegistrationSeq feeds CHR-YYYY-NNNN — 4 DIGITS, deliberately narrower than
   dbo.MembershipApplicationSeq's 5. That sequence is per PROSPECTIVE MEMBER, at national
   scale, every single day; this one is per CHAPTER REGISTRATION (charter once ever, plus
   one officer-turnover filing per chapter per year) — §7A.2 puts the eventual national
   register at ~1,100 chapters, so even every chapter turning over in the same calendar
   year is ~1,100 filings, comfortably inside 4 digits (9,999) with headroom for charters
   too. Under-sizing silently TRUNCATES leading digits past the pad width rather than
   erroring (same risk noted in 08_comms_align.sql) — 4 digits is a deliberate, checked
   choice for THIS sequence's actual volume, not a copy-paste of the 5-digit pattern.

   dbo.ChapterSeq is the chapter number itself — ONE NATIONAL sequence, never per-region.
   Invariant #15 (councils and chapters are never deleted; a reorganised jurisdiction has
   its chapters REASSIGNED to another council) means a chapter's region can change after
   it is chartered. A per-region counter would eventually have to renumber a reassigned
   chapter's member-number prefix, and member numbers must never undergo that — the same
   reasoning that keeps a dissolved council's row in place forever. A single national
   counter never needs to. */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'ChapterRegistrationSeq')
    CREATE SEQUENCE dbo.ChapterRegistrationSeq AS INT START WITH 1 INCREMENT BY 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'ChapterSeq')
    CREATE SEQUENCE dbo.ChapterSeq AS INT START WITH 1 INCREMENT BY 1;
GO

/* ---- dbo.Chapter additions. MarkAccentId/LogoPath back §7A.3's chapter mark (a
   generated monogram is the default — client-side concern, not this schema's — until a
   logo is uploaded, so LogoPath simply stays NULL at charter). CharteredUnderYear
   records the membership year (09 Aug - 08 Aug, named by the year it opens — see
   Akrho.Domain.MembershipYear, whose convention this mirrors exactly rather than
   reinventing) the chapter was chartered under; it is NOT a renewal record (no
   RenewalPeriod/ChapterRenewal row is created here — see this file's header). ---- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'MarkAccentId')
    ALTER TABLE dbo.Chapter ADD MarkAccentId INT NULL REFERENCES dbo.ChapterAccent(AccentId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'LogoPath')
    ALTER TABLE dbo.Chapter ADD LogoPath NVARCHAR(260) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'CharteredUnderYear')
    ALTER TABLE dbo.Chapter ADD CharteredUnderYear INT NULL;
GO
