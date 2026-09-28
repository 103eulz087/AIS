/* Council Portal's global member search — by gift/legal name, member number, or mobile
   number, scoped to the requesting officer's own jurisdiction via fn_MemberCouncilScope.
   A National officer's own council seat's subtree IS the entire tree (fn_CouncilSubtree
   walks down from wherever he is seated), so this one proc covers both cases the client
   asked for with no branch between them: "search everyone" at National, "search only my
   own region/province/city" everywhere else. Never call this with an explicit
   council/chapter id from the request — @RequestingMemberId is the only input that
   decides scope (CLAUDE.md invariant #4), the same posture as every fn_MemberCouncilScope
   caller (usp_Council_GetRoster, usp_CouncilStatistics_Get).

   Deliberately a DIFFERENT visibility rule from usp_Member_Search's own directory (CLAUDE.md
   invariant #7 — "cross-chapter member data is name, chapter, status only"): that invariant
   governs one member browsing OTHER members as a peer, chapter to chapter. This is a seated
   council officer exercising the oversight his office already carries — the same standing
   that lets a CouncilAdmin block a login or a CouncilSecretary verify a chapter registration
   org-wide. Contact details are the whole point of the search (the client asked for mobile
   number as a search key precisely so an officer can find and reach a member), so this
   returns full contact detail for every row in scope, not a restricted cross-chapter shape.

   Covers a detached member (invariant #14 — HomeCouncilId set, ChapterId NULL) by matching
   HomeCouncilId against the caller's scope directly, alongside the ordinary chapter-member
   path through Chapter.ParentCouncilId — CK_Member_Home guarantees at most one of those two
   conditions can ever be true for a given row. No status filter: a council chasing renewals
   needs Lapsed members to surface here at least as readily as Renewed ones (invariant #5/
   the "Lapsed / Renewed / Exempt" vocabulary) — status rides along as a column, never a gate.

   RegionName/ProvinceName/CityName (client decision 2026-09-22 — barangay/chapter names
   collide across municipalities, same reasoning as ChapterRegistrationDetail's own location
   panel) resolve each result's own chapter (or, for a detached member, his HomeCouncilId
   directly) up through the council hierarchy — same recursive-walk shape
   usp_Chapter_ListPublic already uses to answer this exact question, just anchored per
   search result instead of per chapter, and joined AFTER pagination narrows @Take rows
   down, so the walk never runs against more than one page of results. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_SearchByJurisdiction
    @RequestingMemberId INT,
    @Search  NVARCHAR(100),
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId))
        THROW 51830, 'You must hold a currently-seated council office to search members.', 1;

    SET @Search = LTRIM(RTRIM(@Search));
    IF @Search IS NULL OR LEN(@Search) < 2
        THROW 51831, 'Enter at least 2 characters of a name, member number, or mobile number.', 1;

    ;WITH Matches AS (
        SELECT  m.MemberId, m.GiftName, m.MemberNumber,
                m.FirstName, m.MiddleName, m.LastName,
                m.MobileNo, m.Email,
                m.ChapterId, ch.ChapterName,
                m.HomeCouncilId, hc.CouncilName AS HomeCouncilName,
                ms.StatusName, m.RenewedThrough,
                CAST(CASE WHEN ua.IsDisabled = 1 THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
                COALESCE(ch.ParentCouncilId, m.HomeCouncilId) AS LocationCouncilId,
                COUNT(*) OVER() AS TotalCount
        FROM    dbo.Member m
                JOIN dbo.MemberStatus ms     ON ms.StatusId = m.StatusId
                LEFT JOIN dbo.Chapter ch     ON ch.ChapterId = m.ChapterId
                LEFT JOIN dbo.Council hc     ON hc.CouncilId = m.HomeCouncilId
                LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
        WHERE   m.IsDeleted = 0
          AND   EXISTS (
                    SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc
                    WHERE  sc.CouncilId = ch.ParentCouncilId OR sc.CouncilId = m.HomeCouncilId
                )
          AND   (   m.GiftName     LIKE '%' + @Search + '%'
                 OR m.FirstName    LIKE '%' + @Search + '%'
                 OR m.LastName     LIKE '%' + @Search + '%'
                 OR m.MemberNumber LIKE '%' + @Search + '%'
                 OR m.MobileNo     LIKE '%' + @Search + '%'
                )
    ),
    Page AS (
        SELECT * FROM Matches
        ORDER BY GiftName
        OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY
    ),
    CouncilChain AS (
        SELECT  p.MemberId, c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName, 0 AS Depth
        FROM    Page p
                JOIN dbo.Council c       ON c.CouncilId = p.LocationCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        UNION ALL
        SELECT  cc.MemberId, pc.CouncilId, pc.ParentCouncilId, pc.CouncilName, cl.LevelName, cc.Depth + 1
        FROM    CouncilChain cc
                JOIN dbo.Council pc      ON pc.CouncilId = cc.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = pc.CouncilLevelId
        WHERE   cc.Depth < 20
    ),
    Location AS (
        SELECT  MemberId,
                MAX(CASE WHEN LevelName = 'Regional'       THEN CouncilName END) AS RegionName,
                MAX(CASE WHEN LevelName = 'Provincial'     THEN CouncilName END) AS ProvinceName,
                MAX(CASE WHEN LevelName = 'City/Municipal' THEN CouncilName END) AS CityName
        FROM    CouncilChain
        GROUP BY MemberId
    )
    SELECT  p.MemberId, p.GiftName, p.MemberNumber,
            p.FirstName, p.MiddleName, p.LastName,
            p.MobileNo, p.Email,
            p.ChapterId, p.ChapterName,
            p.HomeCouncilId, p.HomeCouncilName,
            p.StatusName, p.RenewedThrough, p.IsBlocked,
            loc.RegionName, loc.ProvinceName, loc.CityName,
            p.TotalCount
    FROM    Page p
            LEFT JOIN Location loc ON loc.MemberId = p.MemberId
    ORDER BY p.GiftName
    OPTION (MAXRECURSION 20);
END
GO
