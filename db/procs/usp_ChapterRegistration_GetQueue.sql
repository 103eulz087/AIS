/* A council officer's own registration queue. Scoped entirely to councils the caller
   CURRENTLY holds a seat on — derived server-side from @RequestingMemberId, never a
   parameter (CLAUDE.md invariant #4). Two kinds of rows come back, distinguished by
   CanAct:
     - CanAct = 1: the caller is seated on the registration's OWN ActingCouncilId — he
       may verify officers, return it, or (if he holds the approver role) approve it.
     - CanAct = 0: the registration is acting at a council somewhere in the SUBTREE of
       one the caller is seated on — read-only visibility (a provincial officer seeing
       what its city councils are handling), via usp_Council_GetSubtree, exactly as
       specified. The action procs (Verify/Return/Approve) each re-check ActingCouncilId
       against the caller's OWN seat independently — this queue's CanAct flag is a
       display convenience only, never itself a permission boundary. */
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
    INSERT INTO @VisibleCouncils (CouncilId) SELECT CouncilId FROM @SeatedCouncils;

    /* usp_Council_GetSubtree, once per seated council — a council officer typically
       holds one seat, occasionally two; this is never a hot path (a queue screen, not a
       per-request scoping check), so a small loop over an existing, already-scoped
       proc is preferred here over duplicating its recursive CTE. */
    DECLARE @SubtreeChapters TABLE (ChapterId INT, ChapterName NVARCHAR(150), CouncilId INT, CouncilName NVARCHAR(150), Depth INT);
    DECLARE @SeatedCouncilId INT;
    DECLARE seat_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT CouncilId FROM @SeatedCouncils;
    OPEN seat_cursor;
    FETCH NEXT FROM seat_cursor INTO @SeatedCouncilId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        INSERT INTO @SubtreeChapters (ChapterId, ChapterName, CouncilId, CouncilName, Depth)
        EXEC dbo.usp_Council_GetSubtree @RootCouncilId = @SeatedCouncilId;
        FETCH NEXT FROM seat_cursor INTO @SeatedCouncilId;
    END
    CLOSE seat_cursor;
    DEALLOCATE seat_cursor;

    INSERT INTO @VisibleCouncils (CouncilId)
    SELECT DISTINCT sc.CouncilId
    FROM   @SubtreeChapters sc
    WHERE  NOT EXISTS (SELECT 1 FROM @VisibleCouncils vc WHERE vc.CouncilId = sc.CouncilId);

    SELECT  cr.RegistrationId, cr.ReferenceNo, cr.RegistrationType, cr.ProposedChapterName,
            cr.ChapterId, ch.ChapterName, cr.StatusId, s.StatusName, cr.SubmittedDate,
            cr.ActingCouncilId, ac.CouncilName AS ActingCouncilName,
            cr.IntendedCouncilId, cr.RoutingReason,
            cr.DecidedBy, cr.DecidedDate,
            CASE WHEN cr.ActingCouncilId IN (SELECT CouncilId FROM @SeatedCouncils) THEN 1 ELSE 0 END AS CanAct,
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
