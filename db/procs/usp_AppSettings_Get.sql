/* The Portal's App settings screen: the free-trial settings, every feature with its "open
   after the trial" flag, and a preview of who the current day count would lock — computed
   whether or not the trial is switched on, so National sees the effect before turning it
   on. Counts only, never names: this is a National overview, not a member list.

   Gate: AppSettings.Manage on a seat on the National Council (office permission grid,
   National-only, President by default) — db/schema/30_app_settings_free_trial.sql.

   Three result sets:
     1. IsTrialEnabled, TrialDays, UpdatedByGiftName, UpdatedDate (latest of the two settings).
     2. Features: FeatureKey, DisplayName, Description, IsAlwaysOpen, IsOpenAfterTrial.
     3. Preview: TotalMembers, PaidMembers, InTrialMembers, TrialOverMembers. */
CREATE OR ALTER PROCEDURE dbo.usp_AppSettings_Get
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

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

    SELECT  CAST(CASE WHEN MAX(CASE WHEN s.SettingKey = N'FreeTrial.Enabled' THEN s.SettingValue END) = N'1'
                      THEN 1 ELSE 0 END AS BIT) AS IsTrialEnabled,
            ISNULL(TRY_CAST(MAX(CASE WHEN s.SettingKey = N'FreeTrial.Days' THEN s.SettingValue END) AS INT), 30) AS TrialDays,
            (SELECT TOP (1) m.GiftName FROM dbo.AppSetting s2 JOIN dbo.Member m ON m.MemberId = s2.UpdatedBy
             WHERE s2.SettingKey LIKE N'FreeTrial.%' ORDER BY s2.UpdatedDate DESC) AS UpdatedByGiftName,
            MAX(s.UpdatedDate) AS UpdatedDate
    FROM    dbo.AppSetting s
    WHERE   s.SettingKey IN (N'FreeTrial.Enabled', N'FreeTrial.Days');

    SELECT  f.FeatureKey, f.DisplayName, f.Description, f.IsAlwaysOpen, f.IsOpenAfterTrial
    FROM    dbo.AppFeature f
    ORDER BY f.SortOrder;

    SELECT  COUNT(*) AS TotalMembers,
            SUM(CASE WHEN a.IsPaid = 1 THEN 1 ELSE 0 END) AS PaidMembers,
            SUM(CASE WHEN a.IsPaid = 0 AND a.IsTrialOver = 0 THEN 1 ELSE 0 END) AS InTrialMembers,
            SUM(CASE WHEN a.IsTrialOver = 1 THEN 1 ELSE 0 END) AS TrialOverMembers
    FROM    dbo.fn_MemberAccess(NULL) a;
END
GO
