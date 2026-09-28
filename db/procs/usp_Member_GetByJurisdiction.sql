/* Council Portal's "View details" — the full member record behind one row of
   usp_Member_SearchByJurisdiction's results. Same column set as usp_Member_GetOwnProfile
   (Address, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
   SeconderMemberId, ApprovedBy/Date, BloodTypeConfirmedDate included) — a seated council
   officer's oversight already carries this much visibility (see
   usp_Member_SearchByJurisdiction.sql's own header comment on why this differs from the
   restricted cross-chapter directory shape); there is no reason the search result row
   should show less than drilling into it does.

   Scoped identically to usp_Member_SearchByJurisdiction: @RequestingMemberId's own
   dbo.fn_MemberCouncilScope decides whether @MemberId is reachable at all — National's
   own scope is the whole tree, everyone else's is only their own subtree. A member
   outside that scope collapses to the same "not found" as a genuinely nonexistent one
   (never a distinguishing 403 — same information-leakage reasoning as
   usp_Member_GetPhoto's own identical collapse).

   RegionName/ProvinceName/CityName: same council-chain walk as
   usp_Member_SearchByJurisdiction's own Location CTE, anchored on this one member's
   chapter (or HomeCouncilId, for a detached member) — see that procedure's header
   comment for the full reasoning. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_GetByJurisdiction
    @RequestingMemberId INT,
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId))
        THROW 51832, 'You must hold a currently-seated council office to view member details.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.Member m
               LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
        WHERE  m.MemberId = @MemberId AND m.IsDeleted = 0
          AND  EXISTS (
                  SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc
                  WHERE sc.CouncilId = ch.ParentCouncilId OR sc.CouncilId = m.HomeCouncilId
              )
    )
        THROW 51833, 'Member not found.', 1;

    DECLARE @LocationCouncilId INT;
    SELECT  @LocationCouncilId = COALESCE(ch.ParentCouncilId, m.HomeCouncilId)
    FROM    dbo.Member m LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
    WHERE   m.MemberId = @MemberId;

    ;WITH CouncilChain AS (
        SELECT  c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName, 0 AS Depth
        FROM    dbo.Council c
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE   c.CouncilId = @LocationCouncilId
        UNION ALL
        SELECT  p.CouncilId, p.ParentCouncilId, p.CouncilName, cl.LevelName, cc.Depth + 1
        FROM    CouncilChain cc
                JOIN dbo.Council p       ON p.CouncilId = cc.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = p.CouncilLevelId
        WHERE   cc.Depth < 20
    )
    -- Result set 1: the full record. Identical column list/order to
    -- usp_Member_GetOwnProfile's own result set 1 plus the three location columns at the
    -- end — a dedicated C# row type carries these, never MemberOwnProfileRow (that shape
    -- is shared with the self-profile screen, which never asked for this).
    SELECT  m.MemberId,
            m.MemberNumber,
            m.FirstName, m.MiddleName, m.LastName, m.GiftName,
            m.Birthdate,
            m.DateSurvive, m.PresidentDuringSurvive, m.MasterInitiatorDuringSurvive,
            m.ChapterId, ch.ChapterName,
            m.HomeCouncilId, co.CouncilName,
            m.ChapterOfRecord,
            m.StatusId, ms.StatusName,
            m.RenewedThrough,
            m.SeconderMemberId, m.ApprovedBy, m.ApprovedDate,
            m.Address,
            m.BloodTypeId, bt.BloodTypeName, m.BloodTypeConfirmedDate,
            m.Profession,
            m.PhotoPath, m.PhotoContentType,
            m.MobileNo, m.Email,
            m.RowVersion,
            (SELECT MAX(CASE WHEN LevelName = 'Regional'       THEN CouncilName END) FROM CouncilChain) AS RegionName,
            (SELECT MAX(CASE WHEN LevelName = 'Provincial'     THEN CouncilName END) FROM CouncilChain) AS ProvinceName,
            (SELECT MAX(CASE WHEN LevelName = 'City/Municipal' THEN CouncilName END) FROM CouncilChain) AS CityName
    FROM    dbo.Member m
            LEFT JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
            LEFT JOIN dbo.Council co      ON co.CouncilId = m.HomeCouncilId
            JOIN      dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
            LEFT JOIN dbo.BloodType bt    ON bt.BloodTypeId = m.BloodTypeId
    WHERE   m.MemberId = @MemberId
    OPTION (MAXRECURSION 20);

    -- Result set 2: his skill ids.
    SELECT SkillId
    FROM   dbo.MemberSkill
    WHERE  MemberId = @MemberId;
END
GO
