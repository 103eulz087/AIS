/* Table-valued parameters. Deployed before any procedure that uses them. */
IF TYPE_ID('dbo.AttendanceRow') IS NULL
CREATE TYPE dbo.AttendanceRow AS TABLE (
    MemberId           INT NOT NULL,
    AttendanceStatusId INT NOT NULL,
    FundAmount         DECIMAL(18,2) NOT NULL DEFAULT 0,
    CheckedInVia       NVARCHAR(10) NULL
);
GO
IF TYPE_ID('dbo.RenewalRow') IS NULL
CREATE TYPE dbo.RenewalRow AS TABLE (
    MemberId      INT NOT NULL,
    RenewalStatus NVARCHAR(10) NOT NULL      -- Renewed | Lapsed | Exempt
);
GO
/* A simple id list. First consumer: usp_Expense_Create's @AttachmentStagingIds — the
   set of dbo.AttachmentStaging rows an expense claims atomically. Kept generic (a bare
   Value column, no per-feature name) since an id list has no shape of its own to add to;
   a second caller with a different set of ids reuses this same type rather than a
   near-identical one being declared per feature. */
IF TYPE_ID('dbo.IntList') IS NULL
CREATE TYPE dbo.IntList AS TABLE (
    Value INT NOT NULL PRIMARY KEY
);
GO

/* Chapter-registration module (db/schema/17_chapter_registration.sql). One TVP per
   registration TYPE, because a Charter officer and a Turnover officer carry genuinely
   different data — a Charter officer is typed in (nobody exists yet); a Turnover
   officer is a bare (office, existing member) pair. Forcing one shape to serve both
   would mean every Turnover call carries eight columns of NULL it can never use. */
IF TYPE_ID('dbo.ChapterCharterOfficerRow') IS NULL
CREATE TYPE dbo.ChapterCharterOfficerRow AS TABLE (
    OfficeId    INT NOT NULL PRIMARY KEY,
    FirstName   NVARCHAR(80)  NOT NULL,
    MiddleName  NVARCHAR(80)  NULL,
    LastName    NVARCHAR(80)  NOT NULL,
    GiftName    NVARCHAR(60)  NOT NULL,
    BirthDate   DATE          NOT NULL,
    MobileNo    NVARCHAR(30)  NOT NULL,
    Email       NVARCHAR(150) NULL,
    DateSurvive DATE          NULL,
    PresidentDuringSurvive       NVARCHAR(120) NULL,
    MasterInitiatorDuringSurvive NVARCHAR(120) NULL
);
GO
IF TYPE_ID('dbo.ChapterTurnoverOfficerRow') IS NULL
CREATE TYPE dbo.ChapterTurnoverOfficerRow AS TABLE (
    OfficeId INT NOT NULL PRIMARY KEY,
    MemberId INT NOT NULL
);
GO
/* usp_ChapterRegistration_Approve's Turnover branch: one row per INCOMING officer who
   needs a brand-new enrolment link (an office that GrantsLogin, with no existing
   dbo.UserAccount row yet). A single scalar @TokenHash (as a lone officer's approval —
   e.g. a Charter's President — needs) cannot serve a turnover, where several different
   people may need several DIFFERENT, cryptographically distinct token hashes in the
   same approval. MemberId is the key (not OfficeId) because the same person keeping an
   office he already holds an account for needs no row here at all. */
IF TYPE_ID('dbo.MemberTokenHashRow') IS NULL
CREATE TYPE dbo.MemberTokenHashRow AS TABLE (
    MemberId  INT NOT NULL PRIMARY KEY,
    TokenHash VARBINARY(32) NOT NULL
);
GO
