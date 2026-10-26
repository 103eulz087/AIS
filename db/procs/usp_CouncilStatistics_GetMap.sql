/* The Council Statistics map (2026-10-26): how many chapters, members and app users each
   province holds, within the caller's own jurisdiction — the same focus council and the
   same CouncilStatistics.Read scope as usp_CouncilStatistics_Get (invariant #4), so a
   provincial council sees its province and National sees the country. Counts only, never
   names (invariant #7 has nothing to give away here).

   Same counting rules as usp_CouncilStatistics_Get, so the map agrees with the tiles on
   the same screen:
     Members  = non-deleted members homed in a chapter in the subtree (every status).
                Detached (council-homed) members belong to no chapter and no place on the
                map (invariant #14) — they are not counted here.
     AppUsers = those members who have a sign-in account (dbo.UserAccount).
     Chapters = chapters in the subtree; ActiveChapters those with IsActive = 1.

   Where a chapter is: dbo.Chapter has no geography of its own (CLAUDE.md §8.9). It is
   read from its council chain — the nearest council with a MunicipalityId (-> that
   municipality's province), ProvinceId, or RegionId — and, for a chapter bootstrapped
   straight under National, from its own chapter registration's RegionId/ProvinceId/
   MunicipalityId (the source of truth §8.9 names). A chapter with no place at all is
   still counted, in the row with NULL codes, so every total reconciles.

   No read-audit row: usp_CouncilStatistics_Get audits the screen's bulk read because it
   carries per-chapter finances; this carries none, and auditing it too would double the
   rows for every view of the same screen.

   Result sets:
     1. FocusCouncilId, FocusCouncilName.
     2. RegionCode, ProvinceCode (either may be NULL), Chapters, ActiveChapters, Members, AppUsers. */
CREATE OR ALTER PROCEDURE dbo.usp_CouncilStatistics_GetMap
    @RequestingMemberId INT,
    @FocusCouncilId     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    /* ---------- Scoping (invariant #4) — identical to usp_CouncilStatistics_Get ---------- */
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberPermissionScope(@RequestingMemberId, N'CouncilStatistics.Read'))
        THROW 51620, 'You do not have permission to view council statistics.', 1;

    IF @FocusCouncilId IS NULL
    BEGIN
        SELECT TOP (1) @FocusCouncilId = mr.ScopeId
        FROM   dbo.MemberRole mr
               JOIN dbo.Council      c  ON c.CouncilId = mr.ScopeId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council'
          AND  mr.TermStart <= @Today
          AND  (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  EXISTS (
                   SELECT 1 FROM dbo.fn_MemberSeatPermissions(@RequestingMemberId) sp
                   WHERE sp.CouncilId = mr.ScopeId AND sp.PermissionKey = N'CouncilStatistics.Read'
               )
        ORDER BY cl.LevelOrder ASC, mr.ScopeId ASC;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberPermissionScope(@RequestingMemberId, N'CouncilStatistics.Read') sc WHERE sc.CouncilId = @FocusCouncilId)
            THROW 51621, 'That council is outside what you are permitted to view.', 1;
    END

    SELECT c.CouncilId AS FocusCouncilId, c.CouncilName AS FocusCouncilName
    FROM   dbo.Council c WHERE c.CouncilId = @FocusCouncilId;

    /* ---------- Where each chapter in the subtree is ---------- */
    DECLARE @Chapters TABLE (ChapterId INT PRIMARY KEY, IsActive BIT, RegionId INT NULL, ProvinceId INT NULL);

    WITH Chain AS (
        SELECT ch.ChapterId, c.CouncilId, c.ParentCouncilId, c.RegionId, c.ProvinceId, c.MunicipalityId, 0 AS Depth
        FROM   dbo.Chapter ch
               JOIN dbo.Council c ON c.CouncilId = ch.ParentCouncilId
        WHERE  ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(@FocusCouncilId))
        UNION ALL
        SELECT k.ChapterId, p.CouncilId, p.ParentCouncilId, p.RegionId, p.ProvinceId, p.MunicipalityId, k.Depth + 1
        FROM   Chain k
               JOIN dbo.Council p ON p.CouncilId = k.ParentCouncilId
    ),
    FromChain AS (
        SELECT  k.ChapterId,
                -- nearest province: a city council's municipality's province, else a provincial council's
                (SELECT TOP (1) COALESCE(mu.ProvinceId, k2.ProvinceId)
                 FROM   Chain k2 LEFT JOIN dbo.Municipality mu ON mu.MunicipalityId = k2.MunicipalityId
                 WHERE  k2.ChapterId = k.ChapterId AND COALESCE(mu.ProvinceId, k2.ProvinceId) IS NOT NULL
                 ORDER BY k2.Depth) AS ProvinceId,
                (SELECT TOP (1) k3.RegionId FROM Chain k3
                 WHERE  k3.ChapterId = k.ChapterId AND k3.RegionId IS NOT NULL ORDER BY k3.Depth) AS RegionId
        FROM    (SELECT DISTINCT ChapterId FROM Chain) k
    ),
    FromRegistration AS (
        -- The chapter's own registration — most recent decided one that created or names it.
        SELECT  x.ChapterId, x.RegionId, x.ProvinceId, x.MunicipalityId
        FROM (
            SELECT  COALESCE(cr.CreatedChapterId, cr.ChapterId) AS ChapterId, cr.RegionId, cr.ProvinceId, cr.MunicipalityId,
                    ROW_NUMBER() OVER (PARTITION BY COALESCE(cr.CreatedChapterId, cr.ChapterId)
                                       ORDER BY cr.SubmittedDate DESC, cr.RegistrationId DESC) AS rn
            FROM    dbo.ChapterRegistration cr
            WHERE   COALESCE(cr.CreatedChapterId, cr.ChapterId) IS NOT NULL
        ) x WHERE x.rn = 1
    )
    INSERT INTO @Chapters (ChapterId, IsActive, RegionId, ProvinceId)
    SELECT  ch.ChapterId, ch.IsActive,
            COALESCE(fc.RegionId, pv.RegionId, fr.RegionId, frp.RegionId) AS RegionId,
            pv.ProvinceId
    FROM    dbo.Chapter ch
            LEFT JOIN FromChain fc        ON fc.ChapterId = ch.ChapterId
            LEFT JOIN FromRegistration fr ON fr.ChapterId = ch.ChapterId
            LEFT JOIN dbo.Municipality frm ON frm.MunicipalityId = fr.MunicipalityId
            LEFT JOIN dbo.Province frp    ON frp.ProvinceId = COALESCE(fr.ProvinceId, frm.ProvinceId)
            LEFT JOIN dbo.Province pv     ON pv.ProvinceId = COALESCE(fc.ProvinceId, frp.ProvinceId)
    WHERE   ch.ParentCouncilId IN (SELECT CouncilId FROM dbo.fn_CouncilSubtree(@FocusCouncilId))
    OPTION (MAXRECURSION 20);

    /* ---------- Counts per place ---------- */
    SELECT  r.RegionCode, p.ProvinceCode,
            COUNT(DISTINCT c.ChapterId) AS Chapters,
            COUNT(DISTINCT CASE WHEN c.IsActive = 1 THEN c.ChapterId END) AS ActiveChapters,
            COUNT(m.MemberId) AS Members,
            COUNT(ua.AccountId) AS AppUsers
    FROM    @Chapters c
            LEFT JOIN dbo.Region r     ON r.RegionId = c.RegionId
            LEFT JOIN dbo.Province p   ON p.ProvinceId = c.ProvinceId
            LEFT JOIN dbo.Member m     ON m.ChapterId = c.ChapterId AND m.IsDeleted = 0
            LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
    GROUP BY r.RegionCode, p.ProvinceCode
    ORDER BY r.RegionCode, p.ProvinceCode;
END
GO
