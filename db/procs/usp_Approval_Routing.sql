/* ============================================================================
   Approval routing — the rule that makes bootstrap an ordinary path.

   An application is approved by the NEAREST EXISTING ANCESTOR with seated officers.

     · Normal      the immediate parent
     · Bootstrap   the parent does not exist yet
     · Dormancy    the parent exists but has nobody seated
     · Delay       the parent exists and will not act (override, after the window)

   The same walk up the tree answers all four, which is why there is no separate
   bootstrap mechanism and no provisional accounts anywhere in this system.
   ============================================================================ */
CREATE OR ALTER FUNCTION dbo.fn_CouncilHasSeatedOfficers (@CouncilId INT)
RETURNS BIT
AS
BEGIN
    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF EXISTS (SELECT 1 FROM dbo.MemberRole mr
               WHERE mr.ScopeType = 'Council' AND mr.ScopeId = @CouncilId
                 AND mr.TermStart <= @Today
                 AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today))
        RETURN 1;
    RETURN 0;
END
GO

/* Resolves who actually approves something sitting under @ParentCouncilId. */
CREATE OR ALTER PROCEDURE dbo.usp_Approval_ResolveApprover
    @ParentCouncilId INT          -- the council the subject SHOULD report to; may not exist
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Current INT = @ParentCouncilId, @Reason NVARCHAR(40) = 'Parent';

    IF @Current IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @Current)
        SET @Reason = 'ParentDoesNotExist';

    /* Walk up until a council exists AND has seated officers. */
    WHILE @Current IS NOT NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @Current)
           AND dbo.fn_CouncilHasSeatedOfficers(@Current) = 1
            BREAK;

        IF EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @Current)
           AND @Reason = 'Parent'
            SET @Reason = 'ParentDormant';

        SELECT @Current = ParentCouncilId FROM dbo.Council WHERE CouncilId = @Current;
        IF @Current IS NULL BREAK;
    END

    IF @Current IS NULL
        THROW 51090, 'No ancestor with seated officers. Seed the National Council and seat its officers first.', 1;

    SELECT  c.CouncilId AS ActingCouncilId, c.CouncilName,
            @ParentCouncilId AS IntendedCouncilId,
            CASE WHEN c.CouncilId = @ParentCouncilId THEN 'Parent' ELSE @Reason END AS RoutingReason
    FROM    dbo.Council c WHERE c.CouncilId = @Current;
END
GO

/* Jurisdictions carrying chapters that ought to have their own council.
   Not a rule violation and not a deadline — information for the National Council.
   A province quietly approving twenty chapters is a workload and legitimacy problem
   that is otherwise invisible until renewal season. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_UnservedJurisdictions
    @MinChapters INT = 3
AS
BEGIN
    SET NOCOUNT ON;
    SELECT  c.CouncilId, c.CouncilName, cl.LevelName,
            COUNT(ch.ChapterId) AS ChaptersCarried,
            dbo.fn_CouncilHasSeatedOfficers(c.CouncilId) AS HasSeatedOfficers
    FROM    dbo.Council c
            JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
            LEFT JOIN dbo.Chapter ch ON ch.ParentCouncilId = c.CouncilId
    GROUP BY c.CouncilId, c.CouncilName, cl.LevelName
    HAVING  COUNT(ch.ChapterId) >= @MinChapters
    ORDER BY COUNT(ch.ChapterId) DESC;
END
GO
