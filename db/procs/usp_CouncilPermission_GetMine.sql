/* "What can I do, and where" — the caller's own council seats and the effective
   permissions each one currently carries. No scoping check needed: this is always and
   only the caller's own data (CLAUDE.md invariant #4 is trivially satisfied — there is
   no @CouncilId input to validate).

   RESULT SET 1 — every council the caller currently holds a LIVE seat on:
     CouncilId, CouncilName, OfficeName, CanManagePermissions (BIT — does this seat's own
     office preside, i.e. is it this council's President).

   RESULT SET 2 — every (CouncilId, PermissionKey) the caller currently holds, from
   dbo.fn_MemberSeatPermissions — this is the set a backend AuthorizationHandler checks a
   request against. */
CREATE OR ALTER PROCEDURE dbo.usp_CouncilPermission_GetMine
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    -- 1. Seats.
    SELECT  mr.ScopeId AS CouncilId, c.CouncilName, seat.OfficeName,
            CAST(ISNULL(seat.IsPresiding, 0) AS BIT) AS CanManagePermissions
    FROM    dbo.MemberRole mr
            JOIN dbo.Council c ON c.CouncilId = mr.ScopeId
            OUTER APPLY (
                SELECT TOP (1) co.OfficeName, co.IsPresiding
                FROM   dbo.CouncilOffice co
                WHERE  co.CouncilOfficeId = mr.CouncilOfficeId
                   OR (mr.CouncilOfficeId IS NULL AND co.RoleId = mr.RoleId)
            ) seat
    WHERE   mr.MemberId  = @MemberId
      AND   mr.ScopeType = 'Council'
      AND   mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today);

    -- 2. Effective permissions. DISTINCT: two offices on one council can grant the same key.
    SELECT  DISTINCT CouncilId, PermissionKey
    FROM    dbo.fn_MemberSeatPermissions(@MemberId);
END
GO
