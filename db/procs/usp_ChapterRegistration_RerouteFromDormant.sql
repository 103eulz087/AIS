/* Moves open chapter registrations off a council that no longer has anyone seated, up to the
   nearest council above it that still does (CLAUDE.md invariant #13a — dormancy is one case
   of the single routing rule, applied here to registrations already filed, not a second
   mechanism; usp_Approval_ResolveApprover is the same walk applied at filing time).

   Why this exists: ActingCouncilId is resolved once, at submit/resubmit. Before this, a
   council that lost its last officer kept every registration already routed to it, and
   nobody anywhere could decide them until someone was seated there again.

   "Seated" here means still seated TOMORROW: TermStart <= today AND (TermEnd IS NULL OR
   TermEnd > today). usp_Council_UnseatOfficer closes a seat with TermEnd = today, which
   fn_CouncilHasSeatedOfficers still counts as seated for the rest of the day; using that
   definition here would mean an unseat never re-routes anything until the next sweep.

   Callers:
     - usp_Council_UnseatOfficer, inside its own transaction, with @CouncilId = the council
       just unseated from and @ActorMemberId = the officer who unseated.
     - The API's RegistrationRerouteHostedService, hourly, with @CouncilId = NULL — catches a
       council going dormant because a fixed term (MemberRole.TermEnd) simply ran out, and
       anything filed to a council during the day its last officer was unseated.

   One-way on purpose: re-seating a council later does NOT pull registrations back down. The
   council that took them over keeps them, so a registration never moves while an officer is
   partway through deciding it. Officer verification ticks already recorded are kept as they
   are — they are facts about the filing, not about which council holds it.

   Only Submitted + open registrations move. ReturnedForCorrection ones re-resolve their own
   routing on resubmit (usp_ChapterRegistration_Resubmit), and Approved ones are decided.
   If no council anywhere above has an officer seated (National itself empty), nothing moves.

   Every move is recorded three ways in the same transaction: an ApprovalRouting row (the
   routing history usp_ChapterRegistration_Get shows), a ChapterRegistrationUpdate row (the
   status timeline the chapter and council see), and an AuditLog row (invariant #10). */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_RerouteFromDormant
    @CouncilId     INT = NULL,
    @ActorMemberId INT = NULL,
    @MovedCount    INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SET @MovedCount = 0;

    -- Councils that will still have someone seated tomorrow.
    DECLARE @Staffed TABLE (CouncilId INT PRIMARY KEY);
    INSERT INTO @Staffed (CouncilId)
    SELECT DISTINCT mr.ScopeId
    FROM   dbo.MemberRole mr
    WHERE  mr.ScopeType = 'Council'
      AND  mr.TermStart <= @Today
      AND  (mr.TermEnd IS NULL OR mr.TermEnd > @Today);

    -- Open, undecided registrations sitting at a council nobody will be seated on.
    DECLARE @Stuck TABLE (
        RegistrationId INT PRIMARY KEY, FromCouncilId INT NOT NULL, RoutingReason NVARCHAR(40) NOT NULL);
    INSERT INTO @Stuck (RegistrationId, FromCouncilId, RoutingReason)
    SELECT cr.RegistrationId, cr.ActingCouncilId, cr.RoutingReason
    FROM   dbo.ChapterRegistration cr
           JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
    WHERE  cr.IsOpen = 1
      AND  s.StatusName = N'Submitted'
      AND  (@CouncilId IS NULL OR cr.ActingCouncilId = @CouncilId)
      AND  NOT EXISTS (SELECT 1 FROM @Staffed st WHERE st.CouncilId = cr.ActingCouncilId);

    IF NOT EXISTS (SELECT 1 FROM @Stuck)
        RETURN;

    -- Nearest staffed council strictly above each stuck council.
    DECLARE @Target TABLE (FromCouncilId INT PRIMARY KEY, ToCouncilId INT NOT NULL);
    WITH up AS (
        SELECT f.FromCouncilId, c.ParentCouncilId AS CouncilId, 1 AS Depth
        FROM   (SELECT DISTINCT FromCouncilId FROM @Stuck) f
               JOIN dbo.Council c ON c.CouncilId = f.FromCouncilId
        WHERE  c.ParentCouncilId IS NOT NULL
        UNION ALL
        SELECT up.FromCouncilId, c.ParentCouncilId, up.Depth + 1
        FROM   up
               JOIN dbo.Council c ON c.CouncilId = up.CouncilId
        WHERE  c.ParentCouncilId IS NOT NULL
    ),
    ranked AS (
        SELECT up.FromCouncilId, up.CouncilId,
               ROW_NUMBER() OVER (PARTITION BY up.FromCouncilId ORDER BY up.Depth) AS rn
        FROM   up
               JOIN @Staffed st ON st.CouncilId = up.CouncilId
    )
    INSERT INTO @Target (FromCouncilId, ToCouncilId)
    SELECT FromCouncilId, CouncilId FROM ranked WHERE rn = 1;

    DECLARE @Moved TABLE (
        RegistrationId INT PRIMARY KEY, FromCouncilId INT NOT NULL, ToCouncilId INT NOT NULL,
        IntendedCouncilId INT NULL, NewReason NVARCHAR(40) NOT NULL, StatusId INT NOT NULL);

    BEGIN TRAN;
        -- 'ParentDoesNotExist' stays as it is (still true); anything else is now dormancy.
        UPDATE cr
           SET ActingCouncilId = t.ToCouncilId,
               RoutingReason   = CASE WHEN s.RoutingReason = N'ParentDoesNotExist'
                                      THEN s.RoutingReason ELSE N'ParentDormant' END
        OUTPUT inserted.RegistrationId, s.FromCouncilId, inserted.ActingCouncilId,
               inserted.IntendedCouncilId, inserted.RoutingReason, inserted.StatusId
          INTO @Moved (RegistrationId, FromCouncilId, ToCouncilId, IntendedCouncilId, NewReason, StatusId)
        FROM   dbo.ChapterRegistration cr
               JOIN @Stuck s  ON s.RegistrationId = cr.RegistrationId
               JOIN @Target t ON t.FromCouncilId = s.FromCouncilId;

        INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId, Remarks)
        SELECT N'Chapter', m.RegistrationId, m.IntendedCouncilId, m.ToCouncilId, m.NewReason, @ActorMemberId,
               CONCAT(N'Moved from ', fc.CouncilName, N' because it no longer has any officers seated.')
        FROM   @Moved m
               JOIN dbo.Council fc ON fc.CouncilId = m.FromCouncilId;

        INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
        SELECT m.RegistrationId, @ActorMemberId, m.StatusId,
               CONCAT(N'Moved to ', tc.CouncilName, N' for a decision, because ', fc.CouncilName,
                      N' no longer has any officers seated.')
        FROM   @Moved m
               JOIN dbo.Council fc ON fc.CouncilId = m.FromCouncilId
               JOIN dbo.Council tc ON tc.CouncilId = m.ToCouncilId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
        SELECT N'ChapterRegistration', CAST(m.RegistrationId AS NVARCHAR(40)), N'Reroute',
               CONCAT(N'{"ActingCouncilId":', m.FromCouncilId, N'}'),
               CONCAT(N'{"ActingCouncilId":', m.ToCouncilId, N',"RoutingReason":"', m.NewReason, N'"}'),
               @ActorMemberId
        FROM   @Moved m;
    COMMIT;

    SELECT @MovedCount = COUNT(*) FROM @Moved;
END
GO
