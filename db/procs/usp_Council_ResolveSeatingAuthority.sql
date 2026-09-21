/* Who may create a council under @CouncilId, or seat/replace/unseat an officer ON
   @CouncilId — invariant #13a applied literally: the nearest existing ancestor with
   seated officers, starting from @CouncilId's own PARENT (never @CouncilId itself,
   unless it IS the root). Delegates to usp_Approval_ResolveApprover, which already
   implements this exact walk for chapter-registration approval — reused verbatim, not
   duplicated, per that invariant's own "never build a second mechanism for any of them".

   The one special case: National has no parent, so there is nothing to walk. National
   seats National — a seated National CouncilAdmin seats National's own officers. This
   is not a second mechanism either; it is the documented fact that the National Council
   has no approver above it (docs §7A.6).

   Called via a plain EXEC + OUTPUT params, never INSERT...EXEC — usp_Council_SeatOfficer
   and usp_Council_Create both call THIS proc the same way, and this proc itself calls
   usp_Approval_ResolveApprover the same way; SQL Server does not allow INSERT...EXEC to
   nest, so keeping every hop in this chain as OUTPUT params (not a captured result set)
   is what lets three procs compose safely. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_ResolveSeatingAuthority
    @CouncilId INT,
    @ActingCouncilId  INT = NULL OUTPUT,
    @RoutingReason    NVARCHAR(40) = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Council WHERE CouncilId = @CouncilId);

    IF @ParentCouncilId IS NULL
    BEGIN
        SET @ActingCouncilId = @CouncilId;
        SET @RoutingReason = 'Root';
    END
    ELSE
    BEGIN
        -- usp_Approval_ResolveApprover ALSO still runs its own SELECT (kept for its
        -- existing INSERT...EXEC callers — usp_ChapterRegistration_Submit/_Resubmit).
        -- Called via plain EXEC here (never nested INSERT...EXEC — this proc has no
        -- caller that wraps IT in one either), that SELECT would otherwise bubble up
        -- as an extra, unwanted result set ahead of whatever THIS proc's own caller
        -- expects — confirmed live: it corrupted usp_Council_EligibleOfficers'
        -- Dapper materialization with "signature (ActingCouncilId, CouncilName,
        -- IntendedCouncilId, RoutingReason)" until this fix. Swallowed into a
        -- throwaway table variable; only the OUTPUT params are actually used.
        DECLARE @Suppress TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
        INSERT INTO @Suppress
        EXEC dbo.usp_Approval_ResolveApprover
            @ParentCouncilId = @ParentCouncilId,
            @ActingCouncilIdOut = @ActingCouncilId OUTPUT,
            @RoutingReasonOut = @RoutingReason OUTPUT;
    END
END
GO
