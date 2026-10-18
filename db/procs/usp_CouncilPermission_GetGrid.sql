/* The permission grid for one council — db/schema/28_council_permissions.sql. Viewable by
   anyone inside the caller's own dbo.fn_MemberCouncilScope (same visibility as
   usp_Council_GetRoster/usp_Council_GetRegistry — any officer who may see this council at
   all may see what it grants, even if he cannot edit it), never by anyone else. Same
   anti-enumeration wording as usp_Council_GetRegistry/usp_Council_GetRoster (51690-51692)
   so a council id outside the caller's scope cannot be distinguished from one that
   doesn't exist.

   FIVE RESULT SETS, IN ORDER:
     1. Header — CouncilId, CouncilName, IsNational, and CanEdit (does the CALLER himself
        hold a currently-seated PRESIDING office on this EXACT council — never a parent's
        President, never a lower seat; see usp_CouncilPermission_Set's matching 51931
        guard for why "exact," not "within scope").
     2. Every council office — the grid's rows.
     3. Every grantable, active catalog key — the grid's columns. National-only keys are
        included only when this council itself IS National (c.ParentCouncilId IS NULL).
     4. Every cell — dbo.fn_CouncilEffectivePermissions(@CouncilId), restricted to the
        same office/key universe as result sets 2-3.
     5. The last 50 changes made to this council's grid, newest first, with the gift name
        of whoever made each one. */
CREATE OR ALTER PROCEDURE dbo.usp_CouncilPermission_GetGrid
    @RequestingMemberId INT,
    @CouncilId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc WHERE sc.CouncilId = @CouncilId)
        THROW 51930, 'That council is outside what you are permitted to view.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @IsNational BIT = CAST(CASE WHEN EXISTS (
        SELECT 1 FROM dbo.Council WHERE CouncilId = @CouncilId AND ParentCouncilId IS NULL
    ) THEN 1 ELSE 0 END AS BIT);

    -- 1. Header.
    SELECT  c.CouncilId, c.CouncilName, @IsNational AS IsNational,
            CAST(CASE WHEN EXISTS (
                SELECT 1 FROM dbo.MemberRole mr
                       JOIN dbo.CouncilOffice co
                            ON co.CouncilOfficeId = mr.CouncilOfficeId
                            OR (mr.CouncilOfficeId IS NULL AND co.RoleId = mr.RoleId)
                WHERE  mr.MemberId  = @RequestingMemberId
                  AND  mr.ScopeType = 'Council' AND mr.ScopeId = @CouncilId
                  AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                  AND  co.IsPresiding = 1
            ) THEN 1 ELSE 0 END AS BIT) AS CanEdit
    FROM    dbo.Council c
    WHERE   c.CouncilId = @CouncilId;

    -- 2. Offices — the grid's rows.
    SELECT  co.CouncilOfficeId AS Id, co.OfficeName AS Name, co.IsPresiding, co.IsReadOnly
    FROM    dbo.CouncilOffice co
    ORDER BY co.CouncilOfficeId;

    -- 3. Catalog keys — the grid's columns.
    SELECT  cp.PermissionKey, cp.DisplayName, cp.Description, cp.IsWrite, cp.IsNationalOnly,
            cp.RequiresKey, cp.SortOrder
    FROM    dbo.CouncilPermission cp
    WHERE   cp.IsGrantable = 1 AND cp.IsActive = 1
      AND   (cp.IsNationalOnly = 0 OR @IsNational = 1)
    ORDER BY cp.SortOrder;

    -- 4. Cells.
    SELECT  cep.CouncilOfficeId, cep.PermissionKey, cep.IsGranted, cep.IsDefault, cep.IsLocked, cep.LockReason
    FROM    dbo.fn_CouncilEffectivePermissions(@CouncilId) cep
            JOIN dbo.CouncilPermission cp ON cp.PermissionKey = cep.PermissionKey
    WHERE   cp.IsGrantable = 1 AND cp.IsActive = 1
      AND   (cp.IsNationalOnly = 0 OR @IsNational = 1);

    -- 5. Last 50 changes.
    SELECT TOP (50)
            h.HistoryId, h.CouncilOfficeId, co.OfficeName, h.PermissionKey,
            h.WasGranted, h.IsGranted, h.ChangedBy, m.GiftName AS ChangedByGiftName,
            h.ChangedDate, h.Reason
    FROM    dbo.CouncilOfficePermissionHistory h
            JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = h.CouncilOfficeId
            JOIN dbo.Member m ON m.MemberId = h.ChangedBy
    WHERE   h.CouncilId = @CouncilId
    ORDER BY h.ChangedDate DESC, h.HistoryId DESC;
END
GO
