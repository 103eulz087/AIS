/* Saves the free-trial settings from the Portal's App settings screen, all at once:
   on/off, the number of days, and the full list of features left open after the trial
   (@OpenFeatureKeys, comma-separated FeatureKeys; any feature not listed is closed after
   the trial). Same gate as usp_AppSettings_Get.

   Always-open features (Announcements) stay open whatever is sent — they can never be
   closed. Every actual change gets its own AuditLog row inside the same transaction
   (invariant #10); saving with nothing changed writes nothing. */
CREATE OR ALTER PROCEDURE dbo.usp_AppSettings_Set
    @RequestingMemberId INT,
    @IsTrialEnabled     BIT,
    @TrialDays          INT,
    @OpenFeatureKeys    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NationalCouncilId INT;
    SELECT  @NationalCouncilId = c.CouncilId
    FROM    dbo.Council c
            JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE   c.ParentCouncilId IS NULL AND cl.LevelName = 'National';

    IF NOT EXISTS (
        SELECT 1 FROM dbo.fn_MemberSeatPermissions(@RequestingMemberId) sp
        WHERE  sp.CouncilId = @NationalCouncilId AND sp.PermissionKey = N'AppSettings.Manage'
    )
        THROW 51950, 'You don''t have permission to manage app settings. Ask the National President to switch on "Manage app settings" for your office.', 1;

    IF @IsTrialEnabled IS NULL
        THROW 51951, 'Choose whether the free trial is on or off.', 1;
    IF @TrialDays IS NULL OR @TrialDays < 1 OR @TrialDays > 365
        THROW 51952, 'The free trial must be between 1 and 365 days.', 1;

    DECLARE @Open TABLE (FeatureKey NVARCHAR(40) PRIMARY KEY);
    INSERT INTO @Open (FeatureKey)
    SELECT DISTINCT LTRIM(RTRIM(value)) FROM STRING_SPLIT(ISNULL(@OpenFeatureKeys, N''), N',')
    WHERE  LTRIM(RTRIM(value)) <> N'';

    IF EXISTS (SELECT 1 FROM @Open o WHERE NOT EXISTS (SELECT 1 FROM dbo.AppFeature f WHERE f.FeatureKey = o.FeatureKey))
        THROW 51953, 'One or more features are not recognised.', 1;

    DECLARE @OldEnabled NVARCHAR(400), @OldDays NVARCHAR(400);
    SELECT @OldEnabled = SettingValue FROM dbo.AppSetting WHERE SettingKey = N'FreeTrial.Enabled';
    SELECT @OldDays    = SettingValue FROM dbo.AppSetting WHERE SettingKey = N'FreeTrial.Days';
    DECLARE @NewEnabled NVARCHAR(400) = CASE WHEN @IsTrialEnabled = 1 THEN N'1' ELSE N'0' END;
    DECLARE @NewDays    NVARCHAR(400) = CAST(@TrialDays AS NVARCHAR(400));

    DECLARE @FeatureChanges TABLE (FeatureKey NVARCHAR(40) PRIMARY KEY, OldValue BIT, NewValue BIT);
    INSERT INTO @FeatureChanges (FeatureKey, OldValue, NewValue)
    SELECT  f.FeatureKey, f.IsOpenAfterTrial,
            CAST(CASE WHEN f.IsAlwaysOpen = 1 OR o.FeatureKey IS NOT NULL THEN 1 ELSE 0 END AS BIT)
    FROM    dbo.AppFeature f
            LEFT JOIN @Open o ON o.FeatureKey = f.FeatureKey
    WHERE   f.IsOpenAfterTrial <> CAST(CASE WHEN f.IsAlwaysOpen = 1 OR o.FeatureKey IS NOT NULL THEN 1 ELSE 0 END AS BIT);

    BEGIN TRAN;
        IF ISNULL(@OldEnabled, N'') <> @NewEnabled
        BEGIN
            MERGE dbo.AppSetting AS t
            USING (SELECT N'FreeTrial.Enabled' AS SettingKey) AS s ON t.SettingKey = s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue = @NewEnabled, UpdatedBy = @RequestingMemberId, UpdatedDate = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (s.SettingKey, @NewEnabled, @RequestingMemberId);

            INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
            VALUES (N'AppSetting', N'FreeTrial.Enabled', N'Update',
                    CONCAT(N'{"Value":"', @OldEnabled, N'"}'), CONCAT(N'{"Value":"', @NewEnabled, N'"}'), @RequestingMemberId);
        END

        IF ISNULL(@OldDays, N'') <> @NewDays
        BEGIN
            MERGE dbo.AppSetting AS t
            USING (SELECT N'FreeTrial.Days' AS SettingKey) AS s ON t.SettingKey = s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue = @NewDays, UpdatedBy = @RequestingMemberId, UpdatedDate = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (s.SettingKey, @NewDays, @RequestingMemberId);

            INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
            VALUES (N'AppSetting', N'FreeTrial.Days', N'Update',
                    CONCAT(N'{"Value":"', @OldDays, N'"}'), CONCAT(N'{"Value":"', @NewDays, N'"}'), @RequestingMemberId);
        END

        UPDATE f
           SET IsOpenAfterTrial = c.NewValue, UpdatedBy = @RequestingMemberId, UpdatedDate = SYSUTCDATETIME()
        FROM   dbo.AppFeature f
               JOIN @FeatureChanges c ON c.FeatureKey = f.FeatureKey;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
        SELECT N'AppFeature', c.FeatureKey, N'Update',
               CONCAT(N'{"IsOpenAfterTrial":', CAST(c.OldValue AS INT), N'}'),
               CONCAT(N'{"IsOpenAfterTrial":', CAST(c.NewValue AS INT), N'}'),
               @RequestingMemberId
        FROM   @FeatureChanges c;
    COMMIT;
END
GO
