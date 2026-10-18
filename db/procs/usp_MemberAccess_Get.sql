/* The free-trial state of one member, and which AIS features are open to him right now
   (db/schema/30_app_settings_free_trial.sql). Read by the API's feature gate on every
   gated request (cached briefly per member) and by GET /api/members/me/access for the
   app's own tabs and banners.

   A member fn_MemberAccess does not cover (not Approved/Active, or deleted) gets an
   unlocked row: whatever else stops him from using the app (sign-in, account block) is
   not this procedure's business, and the gate must never be the thing that fails closed
   for an unrelated reason.

   Two result sets:
     1. IsTrialEnabled, TrialDays, TrialStartedOn, TrialEndsOn, TrialDaysLeft, IsPaid,
        IsLocked, MembershipYear.
     2. Every feature: FeatureKey, DisplayName, IsOpen — all open unless IsLocked, then
        only IsAlwaysOpen/IsOpenAfterTrial ones. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberAccess_Get
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @IsLocked BIT = 0;

    SELECT  @IsLocked = a.IsLocked FROM dbo.fn_MemberAccess(@MemberId) a;

    IF EXISTS (SELECT 1 FROM dbo.fn_MemberAccess(@MemberId))
        SELECT  a.IsTrialEnabled, a.TrialDays, a.TrialStartedOn, a.TrialEndsOn, a.TrialDaysLeft,
                a.IsPaid, a.IsLocked, a.MembershipYear
        FROM    dbo.fn_MemberAccess(@MemberId) a;
    ELSE
        SELECT  CAST(0 AS BIT) AS IsTrialEnabled, CAST(0 AS INT) AS TrialDays,
                CAST(NULL AS DATE) AS TrialStartedOn, CAST(NULL AS DATE) AS TrialEndsOn,
                CAST(0 AS INT) AS TrialDaysLeft, CAST(0 AS BIT) AS IsPaid,
                CAST(0 AS BIT) AS IsLocked, CAST(0 AS INT) AS MembershipYear;

    SELECT  f.FeatureKey, f.DisplayName,
            CAST(CASE WHEN @IsLocked = 0 OR f.IsAlwaysOpen = 1 OR f.IsOpenAfterTrial = 1
                      THEN 1 ELSE 0 END AS BIT) AS IsOpen
    FROM    dbo.AppFeature f
    ORDER BY f.SortOrder;
END
GO
