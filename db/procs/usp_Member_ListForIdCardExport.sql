/* National ID card export — bulk read for the Magicard print run. CALLER MUST BE SEATED
   CouncilAdmin ON THE NATIONAL COUNCIL SPECIFICALLY, not merely any council (this is a
   national-level bulk export of member photos and identifiers across every chapter, a
   materially bigger disclosure than any per-chapter officer screen).

   FINDING "NATIONAL". db/seed/02_demo_chapter.sql identifies the seed row by
   CouncilName = 'National Council', but a name match is fragile — a future data fix or a
   renamed row would silently break this proc's permission check without SQL Server
   raising a single warning. dbo.Council.ParentCouncilId IS NULL is the actual structural
   invariant (01_organization.sql: Council is a self-referencing tree; the row with no
   parent IS the root by construction), and usp_Credential_GetOrIssueForSelf's
   CouncilChain CTE already leans on dbo.CouncilLevel.LevelName = 'National' as the other
   half of that same signal. This proc requires BOTH — root of the tree AND the National
   level row — so a malformed second root-level row without a matching CouncilLevel can
   never be mistaken for the seat that unlocks this export.

   SCOPE. @ChapterId = NULL exports every chapter in the national register; a specific
   value scopes to one chapter. There is no council-subtree walk here on purpose — a
   National CouncilAdmin's seat already covers the whole tree, so unlike
   usp_ChapterRegistration_GetQueue (scoped to the seated council's own subtree) this proc
   does not need to resolve one; it only needs to confirm the ONE National seat exists.

   READ-ONLY. No Member row is created, updated or deleted here (invariant #13: members
   are created by chapters only). dbo.Chapter and photo storage are untouched — PhotoPath /
   PhotoContentType are returned as-is so the API layer can locate the files itself.

   Chapter-homed members only (ChapterId IS NOT NULL): a detached, council-homed member
   (invariant #14, HomeCouncilId set) has no current chapter for a physical card run to be
   organized by, and the whole point of this export is a per-chapter batch for printing —
   so the JOIN to dbo.Chapter naturally, and intentionally, excludes them.

   TokenSubject (nullable): the QR each card carries. LEFT JOIN, not INNER — a credential
   only exists once issued. The caller (API layer) is required to call
   usp_Credential_BulkIssueForExport with the SAME @RequestingMemberId/@ChapterId FIRST, in
   the same request, so that in practice every row here comes back with one; NULL is a
   signal that call was skipped, not an expected steady state. Only a currently-valid
   credential counts (RevokedDate IS NULL AND ExpiryDate > SYSUTCDATETIME()) — the same
   idempotency rule usp_Credential_BulkIssueForExport itself enforces, so this can never
   show a revoked or expired token as if it were live. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_ListForIdCardExport
    @RequestingMemberId INT,
    @ChapterId           INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL
      AND  cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51580, 'The National Council is not configured. Seed it before running an ID card export.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51581, 'Only the National Council Admin may run an ID card export.', 1;

    SELECT  m.MemberId, m.MemberNumber,
            m.FirstName, m.MiddleName, m.LastName, m.GiftName,
            bt.BloodTypeName,
            m.ChapterId, ch.ChapterName, ch.ChapterCode,
            ms.StatusName,
            m.PhotoPath, m.PhotoContentType,
            mc.TokenSubject
    FROM    dbo.Member m
            JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
            LEFT JOIN dbo.BloodType bt ON bt.BloodTypeId = m.BloodTypeId
            LEFT JOIN dbo.MemberCredential mc
                   ON mc.MemberId = m.MemberId
                  AND mc.RevokedDate IS NULL
                  AND mc.ExpiryDate > SYSUTCDATETIME()
    WHERE   m.IsDeleted = 0
      AND   (@ChapterId IS NULL OR m.ChapterId = @ChapterId)
    ORDER BY ch.ChapterName, m.LastName, m.FirstName;
END
GO
