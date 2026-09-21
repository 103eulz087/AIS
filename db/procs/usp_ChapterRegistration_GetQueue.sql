/* A council officer's own registration queue. Scoped entirely to councils the caller
   CURRENTLY holds a seat on — derived server-side from @RequestingMemberId, never a
   parameter (CLAUDE.md invariant #4). Two kinds of rows come back, distinguished by
   CanAct:
     - CanAct = 1: the caller is seated on the registration's OWN ActingCouncilId — he
       may verify officers, return it, or (if he holds the approver role) approve it.
     - CanAct = 0: the registration is acting at a council somewhere in the SUBTREE of
       one the caller is seated on — read-only visibility (a provincial officer seeing
       what its city councils are handling). The action procs (Verify/Return/Approve)
       each re-check ActingCouncilId against the caller's OWN seat independently — this
       queue's CanAct flag is a display convenience only, never itself a permission
       boundary.

   The subtree walk is done here directly over dbo.Council(ParentCouncilId) — the mirror
   image of usp_ChapterRegistration_Get's own ANCESTOR walk — rather than by calling
   usp_Council_GetSubtree. That proc answers a different question ("which chapters sit
   under this council") and, as a side effect of joining to dbo.Chapter, silently omits
   any intermediate council that carries no chapter directly (e.g. a Regional council
   whose chapters all sit one level deeper, under its Provincial/City councils). An
   ActingCouncilId can legitimately land on exactly such a council — §13a routing stops
   at the nearest SEATED ancestor, which has nothing to do with whether that council
   holds a chapter of its own — so a caller seated above it must still see it. Found
   live: a registration routed to a Regional council with zero chapters of its own
   never appeared in the seated National officer's queue. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_GetQueue
    @RequestingMemberId INT,
    @StatusId INT = NULL,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @SeatedCouncils TABLE (CouncilId INT PRIMARY KEY);
    INSERT INTO @SeatedCouncils (CouncilId)
    SELECT DISTINCT mr.ScopeId
    FROM   dbo.MemberRole mr
    WHERE  mr.MemberId  = @RequestingMemberId
      AND  mr.ScopeType = 'Council'
      AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today);

    IF NOT EXISTS (SELECT 1 FROM @SeatedCouncils)
        THROW 51520, 'You do not currently hold a council office, so there is no registration queue to show.', 1;

    DECLARE @VisibleCouncils TABLE (CouncilId INT PRIMARY KEY);
    ;WITH DescendantTree AS (
        SELECT CouncilId, ParentCouncilId FROM dbo.Council WHERE CouncilId IN (SELECT CouncilId FROM @SeatedCouncils)
        UNION ALL
        SELECT c.CouncilId, c.ParentCouncilId
        FROM   dbo.Council c JOIN DescendantTree dt ON c.ParentCouncilId = dt.CouncilId
    )
    INSERT INTO @VisibleCouncils (CouncilId)
    SELECT DISTINCT CouncilId FROM DescendantTree
    OPTION (MAXRECURSION 20);

    SELECT  cr.RegistrationId, cr.ReferenceNo, cr.RegistrationType, cr.ProposedChapterName,
            cr.ChapterId, ch.ChapterName, cr.StatusId, s.StatusName, cr.SubmittedDate,
            cr.ActingCouncilId, ac.CouncilName AS ActingCouncilName,
            cr.IntendedCouncilId, cr.RoutingReason,
            cr.DecidedBy, cr.DecidedDate,
            CAST(CASE WHEN cr.ActingCouncilId IN (SELECT CouncilId FROM @SeatedCouncils) THEN 1 ELSE 0 END AS BIT) AS CanAct,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.ChapterRegistration cr
            JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
            JOIN dbo.Council ac ON ac.CouncilId = cr.ActingCouncilId
            -- COALESCE: a Charter row's ChapterId is NULL forever; CreatedChapterId is
            -- where an approved Charter's chapter actually lives (see usp_ChapterRegistration_Get).
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = COALESCE(cr.ChapterId, cr.CreatedChapterId)
    WHERE   cr.ActingCouncilId IN (SELECT CouncilId FROM @VisibleCouncils)
      AND   (@StatusId IS NULL OR cr.StatusId = @StatusId)
    ORDER BY cr.SubmittedDate DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
