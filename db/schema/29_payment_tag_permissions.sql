/* ============================================================================
   Payment tags join the council office permission grid (2026-10-18).

   Until now usp_MemberPaymentTag_ListMembers/_GetStats/_Set were hardcoded to "seated
   CouncilAdmin on the National Council" — the grid had no row for them, so National's
   President could not hand the job to, say, the Treasurer. Two new National-only keys:

     MemberPaymentTag.Read — see the member payment tag list and the payment report.
     MemberPaymentTag.Set  — change a member's tag (Paid / Unpaid / Free). Requires Read.

   IsNationalOnly = 1: fn_CouncilEffectivePermissions never grants them on any other
   council, usp_CouncilPermission_GetGrid hides them from every other council's grid, and
   usp_CouncilPermission_Set refuses them there. The default grant is National's President
   only, which reproduces the old hardcoded rule exactly until somebody edits the grid.

   Idempotent: each row is inserted only if missing, so this is safe to re-run and safe on
   a database where 28_council_permissions.sql already seeded the original six keys.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM dbo.CouncilPermission WHERE PermissionKey = N'MemberPaymentTag.Read')
    INSERT dbo.CouncilPermission (PermissionKey, DisplayName, Description, IsWrite, IsNationalOnly, IsGrantable, RequiresKey, SortOrder, IsActive)
    VALUES (N'MemberPaymentTag.Read', N'View payment tags',
            N'See every member''s payment tag (Paid, Unpaid or Free) and the payment report.',
            0, 1, 1, NULL, 70, 1);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.CouncilPermission WHERE PermissionKey = N'MemberPaymentTag.Set')
    INSERT dbo.CouncilPermission (PermissionKey, DisplayName, Description, IsWrite, IsNationalOnly, IsGrantable, RequiresKey, SortOrder, IsActive)
    VALUES (N'MemberPaymentTag.Set', N'Update payment tags',
            N'Mark a member as Paid, Unpaid or Free for the membership year.',
            1, 1, 1, N'MemberPaymentTag.Read', 80, 1);
GO

INSERT dbo.CouncilPermissionDefault (CouncilOfficeId, PermissionKey)
SELECT co.CouncilOfficeId, v.PermissionKey
FROM   (VALUES (N'President', N'MemberPaymentTag.Read'),
               (N'President', N'MemberPaymentTag.Set')) AS v(OfficeName, PermissionKey)
       JOIN dbo.CouncilOffice co ON co.OfficeName = v.OfficeName
WHERE  NOT EXISTS (SELECT 1 FROM dbo.CouncilPermissionDefault d
                   WHERE d.CouncilOfficeId = co.CouncilOfficeId AND d.PermissionKey = v.PermissionKey);
GO
