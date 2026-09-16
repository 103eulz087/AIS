/* Resolves the INTENDED council for a charter application's stated location — a
   jurisdiction LOOKUP, not a routing decision. Its output (an intended CouncilId) feeds
   dbo.usp_Approval_ResolveApprover (db/procs/usp_Approval_Routing.sql), which is the
   proc that actually decides who acts on it (walking further up if the intended council
   doesn't exist yet, or exists but has nobody seated).

   usp_Approval_ResolveApprover THROWS 51090 on a NULL @ParentCouncilId rather than
   defaulting to National — by design, that proc never guesses. So THIS lookup must
   ALWAYS return a real council id, falling all the way back to National, which is why
   every branch below is an "if still not found, try the next broader level" step ending
   at National rather than a single query with COALESCE across joins (a COALESCE could
   silently pick a dormant or wrong-level match; this walks level by level instead). */
CREATE OR ALTER PROCEDURE dbo.usp_Council_ResolveJurisdiction
    @RegionId       INT = NULL,
    @ProvinceId     INT = NULL,
    @MunicipalityId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CouncilId INT;

    IF @MunicipalityId IS NOT NULL
        SELECT TOP (1) @CouncilId = CouncilId
        FROM   dbo.Council
        WHERE  MunicipalityId = @MunicipalityId AND IsActive = 1
        ORDER BY CouncilId;

    IF @CouncilId IS NULL AND @ProvinceId IS NOT NULL
        SELECT TOP (1) @CouncilId = CouncilId
        FROM   dbo.Council
        WHERE  ProvinceId = @ProvinceId AND IsActive = 1
        ORDER BY CouncilId;

    IF @CouncilId IS NULL AND @RegionId IS NOT NULL
        SELECT TOP (1) @CouncilId = CouncilId
        FROM   dbo.Council
        WHERE  RegionId = @RegionId AND IsActive = 1
        ORDER BY CouncilId;

    IF @CouncilId IS NULL
        SELECT TOP (1) @CouncilId = c.CouncilId
        FROM   dbo.Council c
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE  cl.LevelName = 'National' AND c.IsActive = 1
        ORDER BY c.CouncilId;

    IF @CouncilId IS NULL
        THROW 51300, 'No council jurisdiction could be resolved — not even National. Seed the National Council first (docs/AIS-Project-Documentation.md §7A.6, step 0).', 1;

    SELECT @CouncilId AS CouncilId;
END
GO
