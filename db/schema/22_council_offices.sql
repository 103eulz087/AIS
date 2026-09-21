/* 22 — Council office catalogue (council-registration module).

   dbo.ChapterOffice cannot be reused: MemberRole.OfficeId's own FK points at
   ChapterOffice specifically, and the eight chapter offices (President..Master
   Initiator III) are not the six council offices docs §7A.5 describes. Council seats
   get their OWN nullable column instead of overloading OfficeId, so a chapter-scoped
   MemberRole row and a council-scoped one can never be confused by a query that forgets
   to filter on ScopeType.

   Unlike dbo.ChapterOffice (Master Initiators recorded with no login), every one of the
   six council offices grants a login — there is no "recorded, no login" council seat. */
/* Council-specific roles this module needs that db/seed/01_reference.sql did not already
   seed. President->CouncilAdmin, Secretary->CouncilSecretary, Treasurer->CouncilTreasurer
   already exist (chapter-registration module) and are reused as-is — only the offices
   without an existing role get one here.

   CouncilAuditor MUST NEVER appear in any write-granting authorization policy anywhere
   in the codebase — same "an auditor who can edit what he audits is not an auditor" rule
   ChapterAuditor already carries (db/seed/01_reference.sql's own comment), noted here so
   the constraint travels with the role's definition regardless of which seed file a
   future reader opens first. */
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RoleName = 'CouncilOfficer')
    INSERT dbo.Role (RoleName, IsCouncilRole) VALUES ('CouncilOfficer', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RoleName = 'CouncilAuditor')
    INSERT dbo.Role (RoleName, IsCouncilRole) VALUES ('CouncilAuditor', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RoleName = 'CouncilPIO')
    INSERT dbo.Role (RoleName, IsCouncilRole) VALUES ('CouncilPIO', 1);
GO

/* RoleId is a real FK, not a name a caller supplies — usp_Council_SeatOfficer derives
   the role to grant FROM the chosen office via this table, exactly the fix 1b's finding
   demanded ("@RoleId is raw — there is no council-office concept at all"). A caller can
   no longer hand in an arbitrary RoleId and seat, say, ChapterAdmin onto a council. */
IF OBJECT_ID('dbo.CouncilOffice') IS NULL
CREATE TABLE dbo.CouncilOffice (
    CouncilOfficeId INT IDENTITY PRIMARY KEY,
    OfficeName      NVARCHAR(60) NOT NULL UNIQUE,
    RoleId          INT          NOT NULL REFERENCES dbo.Role(RoleId),
    GrantsLogin     BIT          NOT NULL DEFAULT 1
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.CouncilOffice)
INSERT dbo.CouncilOffice (OfficeName, RoleId, GrantsLogin)
SELECT v.OfficeName, r.RoleId, 1
FROM (VALUES
    (N'President', 'CouncilAdmin'), (N'Vice President', 'CouncilOfficer'),
    (N'Secretary', 'CouncilSecretary'), (N'Treasurer', 'CouncilTreasurer'),
    (N'Auditor', 'CouncilAuditor'), (N'Public Information Officer', 'CouncilPIO')
) AS v(OfficeName, RoleName)
JOIN dbo.Role r ON r.RoleName = v.RoleName;
GO

/* Nullable: only ever set on a Council-scoped MemberRole row (ScopeType='Council'); a
   Chapter-scoped row leaves it NULL, same "unused for the other scope" shape as every
   other column that only applies to one of MemberRole's two ScopeTypes. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MemberRole') AND name = 'CouncilOfficeId')
    ALTER TABLE dbo.MemberRole ADD CouncilOfficeId INT NULL REFERENCES dbo.CouncilOffice(CouncilOfficeId);
GO

/* At most one LIVE holder per (council, office) — a replace is an explicit unseat-then-
   seat, never an implicit overwrite (usp_Council_SeatOfficer rejects a second live
   holder before this index would ever reject it for real). The filter references only
   plain columns, never SYSUTCDATETIME() or any other non-deterministic function —
   CLAUDE.md §8.15's own filtered-index trap, hit for real on UX_MemberCredential_Member_Live. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MemberRole_CouncilOffice_Live')
    CREATE UNIQUE INDEX UX_MemberRole_CouncilOffice_Live ON dbo.MemberRole(ScopeId, CouncilOfficeId)
        WHERE ScopeType = 'Council' AND CouncilOfficeId IS NOT NULL AND TermEnd IS NULL;
GO
