/* Edits one council's own permission grid — db/schema/28_council_permissions.sql. Only
   that council's OWN currently-seated President may call this; a parent council's
   President cannot reach down and edit a child's grid, and no "manage permissions" key
   exists for anyone to delegate the capability away (see the schema file's own header).

   The whole batch is rejected together — never a partial apply — on any of:
     51931  caller does not hold a live PRESIDING seat on @CouncilId itself.
     51932  a change names a PermissionKey or CouncilOfficeId that does not exist, or a
            key that is inactive or not grantable.
     51933  a change targets the presiding office — its grid row is fixed.
     51934  a change grants a write key to a read-only office.
     51935  a change touches a national-only key on a council that is not National.
     51936  the RESULTING state (after applying every change in the batch) would leave
            some key granted on an office without the key it RequiresKey — checked both
            ways: granting the dependent without the prerequisite, and revoking the
            prerequisite while the dependent stays granted.

   Cells whose effective value would not actually change are silently skipped (no row
   written, no history, no audit) — @Changes is expected to already be a diff, but this
   makes re-submitting the same grid state a harmless no-op either way.

   One transaction: upsert dbo.CouncilOfficePermission, insert one
   dbo.CouncilOfficePermissionHistory row per actual change, insert one dbo.AuditLog row
   per actual change (TableName='CouncilOfficePermission', RecordId='{CouncilId}:
   {CouncilOfficeId}:{PermissionKey}', Action 'Grant'/'Revoke') — or none of it
   (CLAUDE.md invariant #10: audited inside the same transaction as the write). */
CREATE OR ALTER PROCEDURE dbo.usp_CouncilPermission_Set
    @RequestingMemberId INT,
    @CouncilId INT,
    @Changes dbo.CouncilPermissionChangeRow READONLY,
    @Reason NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr
               JOIN dbo.CouncilOffice co
                    ON co.CouncilOfficeId = mr.CouncilOfficeId
                    OR (mr.CouncilOfficeId IS NULL AND co.RoleId = mr.RoleId)
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @CouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  co.IsPresiding = 1
    )
        THROW 51931, 'Only this council''s own seated President may change its permission grid.', 1;

    IF NOT EXISTS (SELECT 1 FROM @Changes)
    BEGIN
        SELECT CAST(0 AS INT) AS ChangedCount;
        RETURN;
    END

    IF EXISTS (
        SELECT 1 FROM @Changes c
               LEFT JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = c.CouncilOfficeId
               LEFT JOIN dbo.CouncilPermission cp
                      ON  cp.PermissionKey = c.PermissionKey
                      AND cp.IsActive = 1 AND cp.IsGrantable = 1
        WHERE  co.CouncilOfficeId IS NULL OR cp.PermissionKey IS NULL
    )
        THROW 51932, 'One or more permissions are not recognised, inactive, or cannot be granted.', 1;

    IF EXISTS (
        SELECT 1 FROM @Changes c JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = c.CouncilOfficeId
        WHERE co.IsPresiding = 1
    )
        THROW 51933, 'The President''s permissions are fixed.', 1;

    IF EXISTS (
        SELECT 1 FROM @Changes c
               JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = c.CouncilOfficeId
               JOIN dbo.CouncilPermission cp ON cp.PermissionKey = c.PermissionKey
        WHERE co.IsReadOnly = 1 AND cp.IsWrite = 1
    )
        THROW 51934, 'A read-only office cannot hold a write permission.', 1;

    DECLARE @IsNational BIT = CAST(CASE WHEN EXISTS (
        SELECT 1 FROM dbo.Council WHERE CouncilId = @CouncilId AND ParentCouncilId IS NULL
    ) THEN 1 ELSE 0 END AS BIT);

    IF @IsNational = 0 AND EXISTS (
        SELECT 1 FROM @Changes c JOIN dbo.CouncilPermission cp ON cp.PermissionKey = c.PermissionKey
        WHERE cp.IsNationalOnly = 1
    )
        THROW 51935, 'This permission applies to the National Council only.', 1;

    -- Only the cells that actually change value are ever written.
    DECLARE @ActualChanges TABLE (CouncilOfficeId INT, PermissionKey NVARCHAR(60), OldValue BIT, NewValue BIT);
    INSERT INTO @ActualChanges (CouncilOfficeId, PermissionKey, OldValue, NewValue)
    SELECT  c.CouncilOfficeId, c.PermissionKey, cep.IsGranted, c.IsGranted
    FROM    @Changes c
            JOIN dbo.fn_CouncilEffectivePermissions(@CouncilId) cep
                 ON cep.CouncilOfficeId = c.CouncilOfficeId AND cep.PermissionKey = c.PermissionKey
    WHERE   cep.IsGranted <> c.IsGranted;

    IF NOT EXISTS (SELECT 1 FROM @ActualChanges)
    BEGIN
        SELECT CAST(0 AS INT) AS ChangedCount;
        RETURN;
    END

    -- Resulting-state RequiresKey check, over every office touched by this batch —
    -- both directions: granting a dependent without its prerequisite, and leaving a
    -- dependent granted while its prerequisite is revoked in the same batch.
    DECLARE @Final TABLE (CouncilOfficeId INT, PermissionKey NVARCHAR(60), IsGranted BIT);
    INSERT INTO @Final (CouncilOfficeId, PermissionKey, IsGranted)
    SELECT  cep.CouncilOfficeId, cep.PermissionKey, COALESCE(ac.NewValue, cep.IsGranted)
    FROM    dbo.fn_CouncilEffectivePermissions(@CouncilId) cep
            LEFT JOIN @ActualChanges ac
                   ON ac.CouncilOfficeId = cep.CouncilOfficeId AND ac.PermissionKey = cep.PermissionKey
    WHERE   cep.CouncilOfficeId IN (SELECT DISTINCT CouncilOfficeId FROM @ActualChanges);

    IF EXISTS (
        SELECT 1 FROM @Final f
               JOIN dbo.CouncilPermission cp ON cp.PermissionKey = f.PermissionKey
               JOIN @Final req ON req.CouncilOfficeId = f.CouncilOfficeId AND req.PermissionKey = cp.RequiresKey
        WHERE f.IsGranted = 1 AND cp.RequiresKey IS NOT NULL AND req.IsGranted = 0
    )
        THROW 51936, 'Verify, Approve, and Return all require Review — grant Review first, or this would leave one of them granted without it.', 1;

    BEGIN TRAN;
        MERGE dbo.CouncilOfficePermission AS tgt
        USING (SELECT CouncilOfficeId, PermissionKey, NewValue FROM @ActualChanges) AS src
           ON  tgt.CouncilId = @CouncilId
           AND tgt.CouncilOfficeId = src.CouncilOfficeId
           AND tgt.PermissionKey = src.PermissionKey
        WHEN MATCHED THEN
            UPDATE SET IsGranted = src.NewValue, ChangedBy = @RequestingMemberId, ChangedDate = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
            INSERT (CouncilId, CouncilOfficeId, PermissionKey, IsGranted, ChangedBy, ChangedDate)
            VALUES (@CouncilId, src.CouncilOfficeId, src.PermissionKey, src.NewValue, @RequestingMemberId, SYSUTCDATETIME());

        INSERT dbo.CouncilOfficePermissionHistory
            (CouncilId, CouncilOfficeId, PermissionKey, WasGranted, IsGranted, ChangedBy, ChangedDate, Reason)
        SELECT @CouncilId, ac.CouncilOfficeId, ac.PermissionKey, ac.OldValue, ac.NewValue,
               @RequestingMemberId, SYSUTCDATETIME(), @Reason
        FROM   @ActualChanges ac;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
        SELECT  'CouncilOfficePermission',
                CONCAT(@CouncilId, N':', ac.CouncilOfficeId, N':', ac.PermissionKey),
                CASE WHEN ac.NewValue = 1 THEN 'Grant' ELSE 'Revoke' END,
                CONCAT(N'{"IsGranted":', CASE WHEN ac.OldValue = 1 THEN N'true' ELSE N'false' END, N'}'),
                CONCAT(N'{"IsGranted":', CASE WHEN ac.NewValue = 1 THEN N'true' ELSE N'false' END, N'}'),
                @RequestingMemberId
        FROM    @ActualChanges ac;
    COMMIT;

    SELECT (SELECT COUNT(*) FROM @ActualChanges) AS ChangedCount;
END
GO
