/* Public, unauthenticated chapter picker for the sign-up form — nobody is signed in yet
   when this is called (§4.1: "Registration is linked from the login page"). Returns only
   what a cascading Region → Province → City → Chapter picker needs: names. No member
   data, no counts, nothing personal — this is not a scoped read, it is deliberately the
   one place in this system that answers the same way for anybody who asks.

   Council-chain names are resolved with the same recursive-walk shape as
   usp_Council_GetSubtree (this codebase's scoping primitive), just walked upward from a
   chapter instead of downward from a council, and pivoted onto one row per chapter by
   CouncilLevel.LevelName. */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_ListPublic
AS
BEGIN
    SET NOCOUNT ON;

    WITH ChapterCouncils AS (
        SELECT ch.ChapterId, c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName, 0 AS Depth
        FROM   dbo.Chapter ch
               JOIN dbo.Council c      ON c.CouncilId = ch.ParentCouncilId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE  ch.IsActive = 1
        UNION ALL
        SELECT cc.ChapterId, p.CouncilId, p.ParentCouncilId, p.CouncilName, cl.LevelName, cc.Depth + 1
        FROM   ChapterCouncils cc
               JOIN dbo.Council p       ON p.CouncilId = cc.ParentCouncilId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = p.CouncilLevelId
    )
    SELECT  ch.ChapterId, ch.ChapterName,
            MAX(CASE WHEN cc.LevelName = 'Regional'       THEN cc.CouncilName END) AS RegionName,
            MAX(CASE WHEN cc.LevelName = 'Provincial'     THEN cc.CouncilName END) AS ProvinceName,
            MAX(CASE WHEN cc.LevelName = 'City/Municipal' THEN cc.CouncilName END) AS CityName
    FROM    dbo.Chapter ch
            JOIN ChapterCouncils cc ON cc.ChapterId = ch.ChapterId
    WHERE   ch.IsActive = 1
    GROUP BY ch.ChapterId, ch.ChapterName
    ORDER BY RegionName, ProvinceName, CityName, ch.ChapterName
    OPTION (MAXRECURSION 20);
END
GO
