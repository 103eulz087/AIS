/* The council registry — every council in @CouncilId's own subtree (or, with @CouncilId
   NULL, the caller's own highest seated council), one row each, with enough to tell the
   THREE distinct no/low-officer states apart in plain language rather than a bare count:

     - Never constituted: no MemberRole row has EVER existed for this council (it was
       auto-created by usp_ChapterRegistration_Approve to give a chapter a parent, or
       just created via usp_Council_Create, and nobody has been seated yet).
     - Dormant: it HAD seated officers once; their terms have all ended.
     - Seated: it has at least one currently-seated officer.
     - Dissolved: IsActive = 0 (no operation writes this today — the column exists,
       nothing sets it — but the read side must render it correctly the day one does).

   Scoped to the caller's own seating authority: he may only see the subtree of a
   council he could plausibly act on (seat/create beneath), resolved via
   usp_Council_ResolveSeatingAuthority against his own highest seat — never an
   unscoped, browsable list of every council nationwide for a non-National caller. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_GetRegistry
    @RequestingMemberId INT,
    @CouncilId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF @CouncilId IS NULL
        SELECT TOP (1) @CouncilId = mr.ScopeId
        FROM   dbo.MemberRole mr JOIN dbo.Council c ON c.CouncilId = mr.ScopeId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE  mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council'
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        ORDER BY cl.LevelOrder ASC;

    IF @CouncilId IS NULL
        THROW 51690, 'You do not currently hold a council office, so there is no registry to show.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc WHERE sc.CouncilId = @CouncilId)
        THROW 51691, 'That council is outside what you are permitted to view.', 1;

    WITH CouncilTree AS (
        SELECT CouncilId, ParentCouncilId, CouncilLevelId, CouncilName, IsActive, 0 AS Depth
        FROM   dbo.Council WHERE CouncilId = @CouncilId
        UNION ALL
        SELECT c.CouncilId, c.ParentCouncilId, c.CouncilLevelId, c.CouncilName, c.IsActive, ct.Depth + 1
        FROM   dbo.Council c JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
    )
    SELECT  ct.CouncilId, ct.CouncilName, cl.LevelName, ct.ParentCouncilId, ct.Depth,
            CAST(ct.IsActive AS BIT) AS IsActive,
            CAST(CASE WHEN ct.IsActive = 0 THEN 1 ELSE 0 END AS BIT) AS IsDissolved,
            CAST(dbo.fn_CouncilHasSeatedOfficers(ct.CouncilId) AS BIT) AS HasSeatedOfficers,
            CAST(CASE WHEN dbo.fn_CouncilHasSeatedOfficers(ct.CouncilId) = 0
                      AND NOT EXISTS (SELECT 1 FROM dbo.MemberRole mr WHERE mr.ScopeType='Council' AND mr.ScopeId = ct.CouncilId)
                      THEN 1 ELSE 0 END AS BIT) AS NeverConstituted,
            CAST(CASE WHEN dbo.fn_CouncilHasSeatedOfficers(ct.CouncilId) = 0
                      AND EXISTS (SELECT 1 FROM dbo.MemberRole mr WHERE mr.ScopeType='Council' AND mr.ScopeId = ct.CouncilId)
                      THEN 1 ELSE 0 END AS BIT) AS IsDormant,
            (SELECT COUNT(*) FROM dbo.MemberRole mr WHERE mr.ScopeType='Council' AND mr.ScopeId = ct.CouncilId
                AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)) AS SeatedOfficerCount,
            (SELECT COUNT(*) FROM dbo.Council c2 WHERE c2.ParentCouncilId = ct.CouncilId) AS DirectChildCouncilCount,
            (SELECT COUNT(*) FROM dbo.Chapter ch WHERE ch.ParentCouncilId = ct.CouncilId) AS DirectChapterCount,
            (SELECT COUNT(*) FROM dbo.Member m JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
                WHERE ch.ParentCouncilId = ct.CouncilId AND m.IsDeleted = 0) AS DirectMemberCount
    FROM    CouncilTree ct
            JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = ct.CouncilLevelId
    ORDER BY ct.Depth, ct.CouncilName
    OPTION (MAXRECURSION 20);
END
GO
