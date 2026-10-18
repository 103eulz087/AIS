/* 28 — Dynamic council office permissions, phase 1.

   Phase 1 covers exactly six capabilities: reviewing/verifying/approving/returning a
   chapter registration, reading council statistics, and searching members council-wide.
   Every one of those reads was previously gated by a hardcoded RoleName IN (...) check
   (CouncilAdmin/CouncilSecretary, or the wider CouncilAdmin/CouncilSecretary/
   CouncilTreasurer/CouncilOfficer/CouncilPIO list for member search) — see
   src/Akrho.Api/Program.cs's AuthorizationPolicies.CouncilChapterRegistrationVerify/
   Approve, CouncilStatisticsRead and CouncilMemberSearchRead for the exact matrix this
   module's CouncilPermissionDefault seed below must reproduce byte for byte. Client
   decision: permissions are granted PER OFFICE, PER COUNCIL (an override, never a
   rewrite of the default), and only that council's own seated President may edit its
   own grid — never a parent council's President editing a child's.

   There is deliberately NO "manage permissions" key anywhere in dbo.CouncilPermission.
   The capability to edit a council's own grid is a structural property of holding the
   council's presiding office (dbo.CouncilOffice.IsPresiding), not a grantable permission
   itself — granting it would let a President delegate away the one check that keeps the
   grid from editing itself.

   Invariant #13 ("no council may enrol anybody, and no procedure that lets one may ever
   be added") is enforced here at the catalog level, not just by code review: CK_
   CouncilPermission_NoEnrol rejects any PermissionKey containing "Enrol" outright, so a
   future developer cannot even seed the capability by mistake.

   TABLES FIRST, THEN THE TWO INLINE TVFs (dbo.fn_CouncilEffectivePermissions,
   dbo.fn_MemberSeatPermissions, dbo.fn_MemberPermissionScope) — same reasoning as
   19_scope_functions.sql's own header: scripts/db-deploy.sh runs every db/schema/ file
   before any db/procs/usp_*.sql file, and SQL Server fails a CREATE PROCEDURE outright
   (not just at execution) if it references a function that does not exist yet. Keeping
   these three functions in a numbered schema file, after the tables they query,
   guarantees that ordering forever. */

/* ---------- CouncilOffice: presiding / read-only flags ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CouncilOffice') AND name = 'IsPresiding')
    ALTER TABLE dbo.CouncilOffice ADD IsPresiding BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CouncilOffice') AND name = 'IsReadOnly')
    ALTER TABLE dbo.CouncilOffice ADD IsReadOnly BIT NOT NULL DEFAULT 0;
GO

-- The President is the ONLY presiding office; the Auditor is the ONLY read-only one —
-- "an auditor who can edit what he audits is not an auditor" (22_council_offices.sql's
-- own comment). Plain UPDATEs, not guarded by IF NOT EXISTS: re-running them sets the
-- same two flags to the same two values every time, which is already idempotent.
UPDATE dbo.CouncilOffice SET IsPresiding = 1 WHERE OfficeName = N'President';
UPDATE dbo.CouncilOffice SET IsReadOnly  = 1 WHERE OfficeName = N'Auditor';
GO

-- At most one presiding office, ever — a filtered index rather than a CHECK constraint
-- because the rule spans rows, not just one. The filter references only a plain column
-- (IsPresiding), never SYSUTCDATETIME() or any other non-deterministic function —
-- CLAUDE.md §8.15's own filtered-index trap.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CouncilOffice_Presiding')
    CREATE UNIQUE INDEX UX_CouncilOffice_Presiding ON dbo.CouncilOffice(IsPresiding) WHERE IsPresiding = 1;
GO

-- One office per role, both directions — dbo.fn_MemberSeatPermissions below resolves a
-- seat's office FROM its RoleId whenever dbo.MemberRole.CouncilOfficeId itself is NULL
-- (every seat seeded before this module shipped, and every xUnit fixture that seats a
-- council officer by RoleId alone — see db/seed/02_demo_chapter.sql's own header on
-- AKR-04-0117-004/-005 — left CouncilOfficeId unset). That resolution is only
-- unambiguous if RoleId is unique across dbo.CouncilOffice; the existing six seeded rows
-- (22_council_offices.sql) already satisfy this, one RoleName per office.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CouncilOffice_Role')
    CREATE UNIQUE INDEX UX_CouncilOffice_Role ON dbo.CouncilOffice(RoleId);
GO

/* ---------- The permission catalog ---------- */
IF OBJECT_ID('dbo.CouncilPermission') IS NULL
CREATE TABLE dbo.CouncilPermission (
    PermissionKey  NVARCHAR(60)  NOT NULL PRIMARY KEY,
    DisplayName    NVARCHAR(100) NOT NULL,
    Description    NVARCHAR(300) NULL,
    IsWrite        BIT           NOT NULL,
    IsNationalOnly BIT           NOT NULL DEFAULT 0,
    IsGrantable    BIT           NOT NULL DEFAULT 1,
    RequiresKey    NVARCHAR(60)  NULL REFERENCES dbo.CouncilPermission(PermissionKey),
    SortOrder      INT           NOT NULL DEFAULT 0,
    IsActive       BIT           NOT NULL DEFAULT 1,
    CONSTRAINT CK_CouncilPermission_NoEnrol CHECK (PermissionKey NOT LIKE N'%Enrol%')
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.CouncilPermission)
BEGIN
    INSERT dbo.CouncilPermission (PermissionKey, DisplayName, Description, IsWrite, IsNationalOnly, IsGrantable, RequiresKey, SortOrder, IsActive)
    VALUES
    (N'ChapterRegistration.Review',  N'Review chapter registrations',        N'See the chapter registrations this council is responsible for deciding.',                 0, 0, 1, NULL,                           10, 1),
    (N'ChapterRegistration.Verify',  N'Verify officers on a registration',   N'Tick off each officer named on a chapter registration as verified.',                      1, 0, 1, N'ChapterRegistration.Review', 20, 1),
    (N'ChapterRegistration.Approve', N'Approve a chapter registration',      N'Give the final approval once every officer has been verified.',                           1, 0, 1, N'ChapterRegistration.Review', 30, 1),
    (N'ChapterRegistration.Return',  N'Return a registration for correction',N'Send a registration back to the chapter with a reason, instead of approving it.',        1, 0, 1, N'ChapterRegistration.Review', 40, 1),
    (N'CouncilStatistics.Read',      N'View council statistics',             N'See the rollup of councils, chapters, and members under this council.',                   0, 0, 1, NULL,                           50, 1),
    (N'CouncilMemberSearch.Read',    N'Search members',                      N'Search for any member under this council''s jurisdiction, with full contact detail.',    0, 0, 1, NULL,                           60, 1);
END
GO

/* ---------- The default grant, by office — reproduces today's hardcoded policy matrix
   exactly (Program.cs's AuthorizationPolicies.CouncilChapterRegistrationVerify/Approve,
   CouncilStatisticsRead = CouncilSecretary + CouncilAdmin i.e. Secretary + President;
   CouncilMemberSearchRead = CouncilSecretary + CouncilAdmin + CouncilTreasurer +
   CouncilOfficer + CouncilPIO i.e. Secretary + President + Treasurer + Vice President +
   PIO). A council with zero CouncilOfficePermission override rows behaves identically to
   the system before this module shipped. ---------- */
IF OBJECT_ID('dbo.CouncilPermissionDefault') IS NULL
CREATE TABLE dbo.CouncilPermissionDefault (
    CouncilOfficeId INT          NOT NULL REFERENCES dbo.CouncilOffice(CouncilOfficeId),
    PermissionKey   NVARCHAR(60) NOT NULL REFERENCES dbo.CouncilPermission(PermissionKey),
    CONSTRAINT PK_CouncilPermissionDefault PRIMARY KEY (CouncilOfficeId, PermissionKey)
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.CouncilPermissionDefault)
BEGIN
    INSERT dbo.CouncilPermissionDefault (CouncilOfficeId, PermissionKey)
    SELECT co.CouncilOfficeId, v.PermissionKey
    FROM   (VALUES
                (N'President',       N'ChapterRegistration.Review'),
                (N'President',       N'ChapterRegistration.Verify'),
                (N'President',       N'ChapterRegistration.Approve'),
                (N'President',       N'ChapterRegistration.Return'),
                (N'President',       N'CouncilStatistics.Read'),
                (N'President',       N'CouncilMemberSearch.Read'),
                (N'Secretary',       N'ChapterRegistration.Review'),
                (N'Secretary',       N'ChapterRegistration.Verify'),
                (N'Secretary',       N'ChapterRegistration.Approve'),
                (N'Secretary',       N'ChapterRegistration.Return'),
                (N'Secretary',       N'CouncilStatistics.Read'),
                (N'Secretary',       N'CouncilMemberSearch.Read'),
                (N'Treasurer',       N'CouncilMemberSearch.Read'),
                (N'Vice President',  N'CouncilMemberSearch.Read'),
                (N'Public Information Officer', N'CouncilMemberSearch.Read')
                -- Auditor: nothing, by design (read-only office, see its IsReadOnly flag above).
           ) AS v(OfficeName, PermissionKey)
           JOIN dbo.CouncilOffice co ON co.OfficeName = v.OfficeName;
END
GO

/* ---------- Overrides. Missing row = default applies. No deletes — an override that is
   later withdrawn is set back to whatever the default would have produced, not removed,
   so dbo.CouncilOfficePermissionHistory keeps an unbroken trail. ---------- */
IF OBJECT_ID('dbo.CouncilOfficePermission') IS NULL
CREATE TABLE dbo.CouncilOfficePermission (
    CouncilId       INT          NOT NULL REFERENCES dbo.Council(CouncilId),
    CouncilOfficeId INT          NOT NULL REFERENCES dbo.CouncilOffice(CouncilOfficeId),
    PermissionKey   NVARCHAR(60) NOT NULL REFERENCES dbo.CouncilPermission(PermissionKey),
    IsGranted       BIT          NOT NULL,
    ChangedBy       INT          NOT NULL REFERENCES dbo.Member(MemberId),
    ChangedDate     DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_CouncilOfficePermission PRIMARY KEY (CouncilId, CouncilOfficeId, PermissionKey)
);
GO

/* ---------- Permanent audit trail, one row per actual change. Append-only, same
   enforcement pattern as dbo.LedgerEntry (TR_LedgerEntry_NoUpdateDelete,
   03_meetings_money.sql) and dbo.CorrectiveAction (TR_CorrectiveAction_NoDelete,
   04_discipline_comms.sql) — an INSTEAD OF trigger, not a convention. ---------- */
IF OBJECT_ID('dbo.CouncilOfficePermissionHistory') IS NULL
CREATE TABLE dbo.CouncilOfficePermissionHistory (
    HistoryId       BIGINT IDENTITY PRIMARY KEY,
    CouncilId       INT          NOT NULL REFERENCES dbo.Council(CouncilId),
    CouncilOfficeId INT          NOT NULL REFERENCES dbo.CouncilOffice(CouncilOfficeId),
    PermissionKey   NVARCHAR(60) NOT NULL REFERENCES dbo.CouncilPermission(PermissionKey),
    WasGranted      BIT          NOT NULL,
    IsGranted       BIT          NOT NULL,
    ChangedBy       INT          NOT NULL REFERENCES dbo.Member(MemberId),
    ChangedDate     DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    Reason          NVARCHAR(300) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouncilOfficePermissionHistory_Council_Date')
    CREATE INDEX IX_CouncilOfficePermissionHistory_Council_Date
        ON dbo.CouncilOfficePermissionHistory(CouncilId, ChangedDate DESC);
GO
CREATE OR ALTER TRIGGER dbo.TR_CouncilOfficePermissionHistory_NoUpdateDelete
ON dbo.CouncilOfficePermissionHistory INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51004, 'CouncilOfficePermissionHistory is append-only and is never corrected or removed.', 1;
END
GO

/* ---------- dbo.fn_CouncilEffectivePermissions — one row per (office, catalog key) for
   a single council, with precedence resolved. Precedence, in order:
     1. A national-only key, on any council that is NOT National (Council.ParentCouncilId
        IS NOT NULL) -> locked, never granted. No override can reach it.
     2. The presiding office (IsPresiding = 1) -> locked, always granted. The President's
        grid row can never be unlocked by an override either.
     3. A write key, on a read-only office (IsReadOnly = 1) -> locked, never granted.
     4. Otherwise: the council's own override (dbo.CouncilOfficePermission) if one
        exists, else the catalog default (dbo.CouncilPermissionDefault) — granted if a
        default row exists for that (office, key) pair, not granted if it does not. */
CREATE OR ALTER FUNCTION dbo.fn_CouncilEffectivePermissions (@CouncilId INT)
RETURNS TABLE
AS
RETURN
(
    SELECT
        co.CouncilOfficeId,
        cp.PermissionKey,
        CAST(CASE
                WHEN cp.IsNationalOnly = 1 AND c.ParentCouncilId IS NOT NULL THEN 0
                WHEN co.IsPresiding = 1 THEN 1
                WHEN cp.IsWrite = 1 AND co.IsReadOnly = 1 THEN 0
                ELSE COALESCE(ovr.IsGranted, CAST(CASE WHEN dflt.CouncilOfficeId IS NOT NULL THEN 1 ELSE 0 END AS BIT))
             END AS BIT) AS IsGranted,
        CAST(CASE WHEN ovr.PermissionKey IS NULL THEN 1 ELSE 0 END AS BIT) AS IsDefault,
        CAST(CASE
                WHEN cp.IsNationalOnly = 1 AND c.ParentCouncilId IS NOT NULL THEN 1
                WHEN co.IsPresiding = 1 THEN 1
                WHEN cp.IsWrite = 1 AND co.IsReadOnly = 1 THEN 1
                ELSE 0
             END AS BIT) AS IsLocked,
        CASE
            WHEN cp.IsNationalOnly = 1 AND c.ParentCouncilId IS NOT NULL THEN N'This permission applies to the National Council only.'
            WHEN co.IsPresiding = 1 THEN N'The President''s permissions are fixed.'
            WHEN cp.IsWrite = 1 AND co.IsReadOnly = 1 THEN N'This office is read-only and cannot hold a write permission.'
            ELSE NULL
        END AS LockReason
    FROM    dbo.Council c
            CROSS JOIN dbo.CouncilOffice co
            CROSS JOIN dbo.CouncilPermission cp
            LEFT JOIN dbo.CouncilOfficePermission ovr
                   ON  ovr.CouncilId = c.CouncilId
                   AND ovr.CouncilOfficeId = co.CouncilOfficeId
                   AND ovr.PermissionKey = cp.PermissionKey
            LEFT JOIN dbo.CouncilPermissionDefault dflt
                   ON  dflt.CouncilOfficeId = co.CouncilOfficeId
                   AND dflt.PermissionKey = cp.PermissionKey
    WHERE   c.CouncilId = @CouncilId
      AND   cp.IsActive = 1
);
GO

/* ---------- dbo.fn_MemberSeatPermissions — every (CouncilId, CouncilOfficeId,
   PermissionKey) a member currently holds, via every LIVE council seat he holds. Same
   TermStart/TermEnd predicate as dbo.fn_MemberCouncilScope (19_scope_functions.sql).

   The seat's office is dbo.MemberRole.CouncilOfficeId when set, else whichever
   dbo.CouncilOffice row's RoleId matches the seat's RoleId (UX_CouncilOffice_Role above
   guarantees at most one) — every seat seeded before this module existed, and every
   xUnit fixture that seats a council officer directly by RoleId, resolves correctly
   through this fallback with no data migration required. */
CREATE OR ALTER FUNCTION dbo.fn_MemberSeatPermissions (@MemberId INT)
RETURNS TABLE
AS
RETURN
(
    SELECT  mr.ScopeId AS CouncilId, cep.CouncilOfficeId, cep.PermissionKey
    FROM    dbo.MemberRole mr
            CROSS APPLY (
                SELECT TOP (1) co.CouncilOfficeId
                FROM   dbo.CouncilOffice co
                WHERE  co.CouncilOfficeId = mr.CouncilOfficeId
                   OR (mr.CouncilOfficeId IS NULL AND co.RoleId = mr.RoleId)
            ) seat
            CROSS APPLY dbo.fn_CouncilEffectivePermissions(mr.ScopeId) cep
    WHERE   mr.MemberId  = @MemberId
      AND   mr.ScopeType = 'Council'
      AND   mr.TermStart <= CAST(SYSUTCDATETIME() AS DATE)
      AND   (mr.TermEnd IS NULL OR mr.TermEnd >= CAST(SYSUTCDATETIME() AS DATE))
      AND   cep.CouncilOfficeId = seat.CouncilOfficeId
      AND   cep.IsGranted = 1
);
GO

/* ---------- dbo.fn_MemberPermissionScope — the permission-filtered twin of
   dbo.fn_MemberCouncilScope: every council in the subtree of a seat that currently holds
   @PermissionKey, unioned across every such seat the member has. A read procedure that
   used to call fn_MemberCouncilScope to decide "can this caller see this council" now
   calls this instead, parameterised by the one capability that read actually requires. */
CREATE OR ALTER FUNCTION dbo.fn_MemberPermissionScope (@MemberId INT, @PermissionKey NVARCHAR(60))
RETURNS TABLE
AS
RETURN
(
    SELECT DISTINCT st.CouncilId
    FROM   dbo.fn_MemberSeatPermissions(@MemberId) sp
           CROSS APPLY dbo.fn_CouncilSubtree(sp.CouncilId) st
    WHERE  sp.PermissionKey = @PermissionKey
);
GO
