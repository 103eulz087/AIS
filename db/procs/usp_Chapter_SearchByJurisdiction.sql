/* Council Portal's chapter search for the hold/release settings screen — by chapter
   name, scoped to the requesting officer's own jurisdiction via fn_MemberCouncilScope,
   same shape as usp_Member_SearchByJurisdiction (see that procedure's own header for
   the full reasoning: National's own scope is the whole tree, so one proc naturally
   covers "search every chapter" and "search only my own region/province/city" with no
   branch between them).

   RegionName/ProvinceName/CityName resolved the same council-chain walk as
   usp_Chapter_ListPublic already uses, MemberCount a plain live count (IsDeleted = 0),
   IsOnHold read straight off dbo.Chapter — this screen's whole reason to exist is
   showing that flag and letting an eligible officer flip it (usp_Chapter_Hold/_Release
   re-derive the real per-chapter authority themselves; this search has no authority
   check beyond "do you hold a council seat at all," the same read-only bar as
   usp_Member_SearchByJurisdiction). */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_SearchByJurisdiction
    @RequestingMemberId INT,
    @Search  NVARCHAR(100),
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId))
        THROW 51840, 'You must hold a currently-seated council office to search chapters.', 1;

    SET @Search = LTRIM(RTRIM(@Search));
    IF @Search IS NULL OR LEN(@Search) < 2
        THROW 51841, 'Enter at least 2 characters of a chapter name.', 1;

    ;WITH Matches AS (
        SELECT  ch.ChapterId, ch.ChapterName, ch.ParentCouncilId, ch.IsOnHold,
                (SELECT COUNT(*) FROM dbo.Member m WHERE m.ChapterId = ch.ChapterId AND m.IsDeleted = 0) AS MemberCount,
                COUNT(*) OVER() AS TotalCount
        FROM    dbo.Chapter ch
        WHERE   ch.ChapterName LIKE '%' + @Search + '%'
          AND   EXISTS (
                    SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc
                    WHERE  sc.CouncilId = ch.ParentCouncilId
                )
    ),
    Page AS (
        SELECT * FROM Matches
        ORDER BY ChapterName
        OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY
    ),
    CouncilChain AS (
        SELECT  p.ChapterId, c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName, 0 AS Depth
        FROM    Page p
                JOIN dbo.Council c       ON c.CouncilId = p.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        UNION ALL
        SELECT  cc.ChapterId, pc.CouncilId, pc.ParentCouncilId, pc.CouncilName, cl.LevelName, cc.Depth + 1
        FROM    CouncilChain cc
                JOIN dbo.Council pc      ON pc.CouncilId = cc.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = pc.CouncilLevelId
        WHERE   cc.Depth < 20
    ),
    Location AS (
        SELECT  ChapterId,
                MAX(CASE WHEN LevelName = 'Regional'       THEN CouncilName END) AS RegionName,
                MAX(CASE WHEN LevelName = 'Provincial'     THEN CouncilName END) AS ProvinceName,
                MAX(CASE WHEN LevelName = 'City/Municipal' THEN CouncilName END) AS CityName
        FROM    CouncilChain
        GROUP BY ChapterId
    )
    SELECT  p.ChapterId, p.ChapterName, p.IsOnHold, p.MemberCount,
            loc.RegionName, loc.ProvinceName, loc.CityName,
            p.TotalCount
    FROM    Page p
            LEFT JOIN Location loc ON loc.ChapterId = p.ChapterId
    ORDER BY p.ChapterName
    OPTION (MAXRECURSION 20);
END
GO
