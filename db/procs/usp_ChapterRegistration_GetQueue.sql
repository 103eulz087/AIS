/* A council officer's own registration queue. Scoped entirely to councils where the
   caller holds a currently-seated office granting the dynamic ChapterRegistration.Review
   permission (db/schema/28_council_permissions.sql) — derived server-side from
   @RequestingMemberId, never a parameter (CLAUDE.md invariant #4). CanAct is now the OR
   of three independent flags, each a direct-seat check on the registration's OWN
   ActingCouncilId:
     - CanVerify  — caller holds ChapterRegistration.Verify there.
     - CanApprove — caller holds ChapterRegistration.Approve there.
     - CanReturn  — caller holds ChapterRegistration.Return there.
   A registration acting at a council somewhere in the SUBTREE of one the caller holds
   Review on (but not ActingCouncilId itself) is still visible, with all three flags 0 —
   read-only visibility (a provincial officer seeing what its city councils are
   handling). The action procs (Verify/Return/Approve) each re-check ActingCouncilId
   against the caller's OWN seat independently — these flags are a display convenience
   only, never themselves a permission boundary.

   @MyPerms (below) is this member's own effective ChapterRegistration.* permissions,
   fetched ONCE from dbo.fn_MemberSeatPermissions rather than once per returned row.
   @VisibleCouncils is its Review-holding councils' combined dbo.fn_CouncilSubtree —
   equivalent to, and built on the same primitive as, dbo.fn_MemberPermissionScope
   (db/schema/28_council_permissions.sql) — so an ActingCouncilId that is a Regional
   council with zero chapters of its own (§13a routing stops at the nearest SEATED
   ancestor, which has nothing to do with whether that council holds a chapter directly)
   still surfaces correctly — found live, before this refactor, as "a registration routed
   to a Regional council with zero chapters of its own never appeared in the seated
   National officer's queue."

   @Search (optional) narrows the SAME scoped set — it never widens it. Matches the
   reference number, the chapter (existing or proposed name), or any officer named on
   the filing (gift name, first/last name, or member number of a linked member). Only
   registration rows come back; no officer contact detail is ever returned here. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_GetQueue
    @RequestingMemberId INT,
    @StatusId INT = NULL,
    @Search NVARCHAR(100) = NULL,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    -- Wildcards in what the officer typed are matched literally, never as patterns.
    SET @Search = NULLIF(LTRIM(RTRIM(@Search)), N'');
    DECLARE @Pattern NVARCHAR(320) = CASE WHEN @Search IS NULL THEN NULL ELSE
        N'%' + REPLACE(REPLACE(REPLACE(REPLACE(@Search, N'\', N'\\'), N'%', N'\%'), N'_', N'\_'), N'[', N'\[') + N'%' END;

    -- Materialized ONCE, not per returned row — this member's own effective permissions
    -- over the four ChapterRegistration.* keys only. CanVerify/CanApprove/CanReturn/CanAct
    -- below are plain EXISTS checks against this local table, never a fresh call to
    -- dbo.fn_MemberSeatPermissions per row (this proc can return up to @Take rows).
    DECLARE @MyPerms TABLE (CouncilId INT NOT NULL, PermissionKey NVARCHAR(60) NOT NULL, PRIMARY KEY (CouncilId, PermissionKey));
    -- DISTINCT: a member seated in two offices on one council (e.g. President and Secretary)
    -- holds the same key twice in fn_MemberSeatPermissions; without it the PK rejects the insert.
    INSERT INTO @MyPerms (CouncilId, PermissionKey)
    SELECT DISTINCT sp.CouncilId, sp.PermissionKey
    FROM   dbo.fn_MemberSeatPermissions(@RequestingMemberId) sp
    WHERE  sp.PermissionKey IN (N'ChapterRegistration.Review', N'ChapterRegistration.Verify',
                                 N'ChapterRegistration.Approve', N'ChapterRegistration.Return');

    DECLARE @SeatedCouncils TABLE (CouncilId INT PRIMARY KEY);
    INSERT INTO @SeatedCouncils (CouncilId)
    SELECT DISTINCT CouncilId FROM @MyPerms WHERE PermissionKey = N'ChapterRegistration.Review';

    IF NOT EXISTS (SELECT 1 FROM @SeatedCouncils)
        THROW 51520, 'You do not have permission to review chapter registrations.', 1;

    DECLARE @VisibleCouncils TABLE (CouncilId INT PRIMARY KEY);
    INSERT INTO @VisibleCouncils (CouncilId)
    SELECT DISTINCT st.CouncilId
    FROM   @SeatedCouncils sc
           CROSS APPLY dbo.fn_CouncilSubtree(sc.CouncilId) st;

    SELECT  cr.RegistrationId, cr.ReferenceNo, cr.RegistrationType, cr.ProposedChapterName,
            cr.ChapterId, ch.ChapterName, cr.StatusId, s.StatusName, cr.SubmittedDate,
            cr.ActingCouncilId, ac.CouncilName AS ActingCouncilName,
            cr.IntendedCouncilId, cr.RoutingReason,
            cr.DecidedBy, cr.DecidedDate,
            CAST(CASE WHEN EXISTS (
                SELECT 1 FROM @MyPerms mp
                WHERE mp.CouncilId = cr.ActingCouncilId
                  AND mp.PermissionKey IN (N'ChapterRegistration.Verify', N'ChapterRegistration.Approve', N'ChapterRegistration.Return')
            ) THEN 1 ELSE 0 END AS BIT) AS CanAct,
            COUNT(*) OVER() AS TotalCount,
            CAST(CASE WHEN EXISTS (
                SELECT 1 FROM @MyPerms mp WHERE mp.CouncilId = cr.ActingCouncilId AND mp.PermissionKey = N'ChapterRegistration.Verify'
            ) THEN 1 ELSE 0 END AS BIT) AS CanVerify,
            CAST(CASE WHEN EXISTS (
                SELECT 1 FROM @MyPerms mp WHERE mp.CouncilId = cr.ActingCouncilId AND mp.PermissionKey = N'ChapterRegistration.Approve'
            ) THEN 1 ELSE 0 END AS BIT) AS CanApprove,
            CAST(CASE WHEN EXISTS (
                SELECT 1 FROM @MyPerms mp WHERE mp.CouncilId = cr.ActingCouncilId AND mp.PermissionKey = N'ChapterRegistration.Return'
            ) THEN 1 ELSE 0 END AS BIT) AS CanReturn
    FROM    dbo.ChapterRegistration cr
            JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
            JOIN dbo.Council ac ON ac.CouncilId = cr.ActingCouncilId
            -- COALESCE: a Charter row's ChapterId is NULL forever; CreatedChapterId is
            -- where an approved Charter's chapter actually lives (see usp_ChapterRegistration_Get).
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = COALESCE(cr.ChapterId, cr.CreatedChapterId)
    WHERE   cr.ActingCouncilId IN (SELECT CouncilId FROM @VisibleCouncils)
      AND   (@StatusId IS NULL OR cr.StatusId = @StatusId)
      AND   (@Pattern IS NULL
             OR cr.ReferenceNo         LIKE @Pattern ESCAPE N'\'
             OR cr.ProposedChapterName LIKE @Pattern ESCAPE N'\'
             OR ch.ChapterName         LIKE @Pattern ESCAPE N'\'
             OR EXISTS (
                    SELECT 1
                    FROM   dbo.ChapterRegistrationOfficer o
                           LEFT JOIN dbo.Member om ON om.MemberId = o.MemberId
                    WHERE  o.RegistrationId = cr.RegistrationId
                      AND (   o.GiftName      LIKE @Pattern ESCAPE N'\'
                           OR o.FirstName     LIKE @Pattern ESCAPE N'\'
                           OR o.LastName      LIKE @Pattern ESCAPE N'\'
                           OR om.GiftName     LIKE @Pattern ESCAPE N'\'
                           OR om.FirstName    LIKE @Pattern ESCAPE N'\'
                           OR om.LastName     LIKE @Pattern ESCAPE N'\'
                           OR om.MemberNumber LIKE @Pattern ESCAPE N'\'
                           OR CONCAT(COALESCE(om.FirstName, o.FirstName), N' ', COALESCE(om.LastName, o.LastName)) LIKE @Pattern ESCAPE N'\')))
    ORDER BY cr.SubmittedDate DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
