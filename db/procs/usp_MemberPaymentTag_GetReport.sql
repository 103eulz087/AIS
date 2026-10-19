/* The Payment report (2026-10-19) — one row per chapter with its active members counted by
   payment-tag status for a membership year, plus the chapter's region, province and city so
   the Portal can search and filter by place. Replaces usp_MemberPaymentTag_GetStats for the
   report screen; GetStats is left as it is only for the API build already deployed, whose
   row mapping expects GetStats' exact columns (CLAUDE.md §8.7) — drop it once that build is
   gone.

   Gate: MemberPaymentTag.Report ("View payment report") on a seat on the National Council
   (office permission grid, National-only, President by default —
   db/schema/32_payment_report_permission.sql).

   Same counting rules as GetStats: chapter-homed, non-deleted members; the latest tag action
   for the year decides — 'Tagged' = Paid, 'Free' = Free, anything else or none = Unpaid.
   Place names come from walking the chapter's council chain upward, the same way
   usp_Chapter_ListPublic does (dbo.Chapter has no geography of its own); a chapter
   bootstrapped straight under National has none, and its place columns are NULL.
   Counts only, never member names — invariant #7 has nothing to give away here. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberPaymentTag_GetReport
    @RequestingMemberId INT,
    @MembershipYear     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF @MembershipYear IS NULL
        SET @MembershipYear = CASE WHEN @Today > DATEFROMPARTS(YEAR(@Today), 8, 8)
                                   THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL AND cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51910, 'The National Council is not configured.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.fn_MemberSeatPermissions(@RequestingMemberId) sp
        WHERE  sp.CouncilId = @NationalCouncilId AND sp.PermissionKey = N'MemberPaymentTag.Report'
    )
        THROW 51911, 'You don''t have permission to view the payment report. Ask the National President to switch on "View payment report" for your office.', 1;

    WITH LatestAction AS (
        SELECT  MemberId, ActionType,
                ROW_NUMBER() OVER (PARTITION BY MemberId ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC) AS rn
        FROM    dbo.MemberPaymentTagAction
        WHERE   MembershipYear = @MembershipYear
    ),
    Counts AS (
        SELECT  m.ChapterId,
                COUNT(*) AS TotalMembers,
                SUM(CASE WHEN la.ActionType = 'Tagged' THEN 1 ELSE 0 END) AS PaidCount,
                SUM(CASE WHEN la.ActionType = 'Free'   THEN 1 ELSE 0 END) AS FreeCount,
                SUM(CASE WHEN la.ActionType IS NULL OR la.ActionType NOT IN ('Tagged', 'Free') THEN 1 ELSE 0 END) AS UnpaidCount
        FROM    dbo.Member m
                LEFT JOIN LatestAction la ON la.MemberId = m.MemberId AND la.rn = 1
        WHERE   m.IsDeleted = 0 AND m.ChapterId IS NOT NULL
        GROUP BY m.ChapterId
    ),
    ChapterCouncils AS (
        SELECT ch.ChapterId, c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName
        FROM   dbo.Chapter ch
               JOIN Counts k            ON k.ChapterId = ch.ChapterId
               JOIN dbo.Council c       ON c.CouncilId = ch.ParentCouncilId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        UNION ALL
        SELECT cc.ChapterId, p.CouncilId, p.ParentCouncilId, p.CouncilName, cl.LevelName
        FROM   ChapterCouncils cc
               JOIN dbo.Council p       ON p.CouncilId = cc.ParentCouncilId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = p.CouncilLevelId
    ),
    Places AS (
        SELECT  ChapterId,
                MAX(CASE WHEN LevelName = 'Regional'       THEN CouncilName END) AS RegionName,
                MAX(CASE WHEN LevelName = 'Provincial'     THEN CouncilName END) AS ProvinceName,
                MAX(CASE WHEN LevelName = 'City/Municipal' THEN CouncilName END) AS CityName
        FROM    ChapterCouncils
        GROUP BY ChapterId
    )
    SELECT  ch.ChapterId, ch.ChapterName,
            pl.RegionName, pl.ProvinceName, pl.CityName,
            k.TotalMembers, k.PaidCount, k.FreeCount, k.UnpaidCount,
            @MembershipYear AS MembershipYear
    FROM    Counts k
            JOIN dbo.Chapter ch ON ch.ChapterId = k.ChapterId
            LEFT JOIN Places pl ON pl.ChapterId = k.ChapterId
    ORDER BY ch.ChapterName
    OPTION (MAXRECURSION 20);
END
GO
