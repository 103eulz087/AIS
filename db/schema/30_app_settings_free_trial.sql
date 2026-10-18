/* ============================================================================
   App settings + the free trial (2026-10-18).

   Client decision: a member who has not paid for the current membership year gets full
   use of the AIS app for a free trial that starts the day he was approved as a member.
   Once it runs out he keeps only Announcements, plus whatever other features National
   chooses to leave open. One setting for everyone — never per member, chapter or council.

   "Paid" means exactly what the Digital ID's NOT YET PAID watermark already means: the
   latest dbo.MemberPaymentTagAction for the current membership year is 'Tagged' or 'Free'
   (usp_Credential_GetOrIssueForSelf). Invariant #5 still holds: this is the membership
   payment tag, never meeting contributions, and nothing anywhere computes or shows an
   amount owed. Being locked is not disciplinary and carries no record of its own.

   Off by default (FreeTrial.Enabled = '0'): deploying this changes nothing for anybody
   until National switches it on from the Portal's App settings screen, which also shows
   how many members would be locked before it is switched on.

   Tables:
     dbo.AppSetting — app-wide key/value settings. Values are typed by their key's own
       convention (FreeTrial.Enabled is '0'/'1', FreeTrial.Days is a whole number).
     dbo.AppFeature — the AIS features the free trial can close, each with its own
       "still open after the trial" flag. IsAlwaysOpen marks Announcements: it can never
       be closed, so a locked member always has somewhere to go.
   Every change is written through usp_AppSettings_Set, which audits it (invariant #10).
   ============================================================================ */

IF OBJECT_ID('dbo.AppSetting') IS NULL
CREATE TABLE dbo.AppSetting (
    SettingKey   NVARCHAR(60)  NOT NULL PRIMARY KEY,
    SettingValue NVARCHAR(400) NOT NULL,
    UpdatedBy    INT           NULL REFERENCES dbo.Member(MemberId),
    UpdatedDate  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.AppSetting WHERE SettingKey = N'FreeTrial.Enabled')
    INSERT dbo.AppSetting (SettingKey, SettingValue) VALUES (N'FreeTrial.Enabled', N'0');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSetting WHERE SettingKey = N'FreeTrial.Days')
    INSERT dbo.AppSetting (SettingKey, SettingValue) VALUES (N'FreeTrial.Days', N'30');
GO

IF OBJECT_ID('dbo.AppFeature') IS NULL
CREATE TABLE dbo.AppFeature (
    FeatureKey       NVARCHAR(40)  NOT NULL PRIMARY KEY,
    DisplayName      NVARCHAR(80)  NOT NULL,
    Description      NVARCHAR(300) NOT NULL,
    SortOrder        INT           NOT NULL,
    IsAlwaysOpen     BIT           NOT NULL DEFAULT 0,
    IsOpenAfterTrial BIT           NOT NULL DEFAULT 0,
    UpdatedBy        INT           NULL REFERENCES dbo.Member(MemberId),
    UpdatedDate      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_AppFeature_AlwaysOpen CHECK (IsAlwaysOpen = 0 OR IsOpenAfterTrial = 1)
);
GO
-- The keys are referenced by the API (RequireFeature on each endpoint group) and the web
-- app (AppShell tabs). Add a feature here before gating anything with it.
INSERT dbo.AppFeature (FeatureKey, DisplayName, Description, SortOrder, IsAlwaysOpen, IsOpenAfterTrial)
SELECT v.FeatureKey, v.DisplayName, v.Description, v.SortOrder, v.IsAlwaysOpen, v.IsAlwaysOpen
FROM (VALUES
    (N'Announcements',     N'Announcements',          N'Chapter and National announcements. Always open.',                                   10, 1),
    (N'Dashboard',         N'Dashboard',              N'The chapter''s summary page.',                                                       20, 0),
    (N'Members',           N'Members directory',      N'Browse and search the chapter''s members.',                                          30, 0),
    (N'Meetings',          N'Meetings',               N'Meetings, attendance and contributions.',                                            40, 0),
    (N'Funds',             N'Funds',                  N'The ledger, activities, expenses and donations.',                                    50, 0),
    (N'Memos',             N'Memos',                  N'Chapter memos.',                                                                     60, 0),
    (N'CorrectiveActions', N'Corrective actions',     N'The chapter''s corrective action records.',                                          70, 0),
    (N'ChapterChat',       N'Chapter chat',           N'The chapter''s group chat.',                                                         80, 0),
    (N'PrivateMessages',   N'Private messages',       N'One-to-one messages between members.',                                               90, 0),
    (N'DigitalId',         N'Digital ID',             N'The member''s digital ID card and QR scanning.',                                    100, 0),
    (N'ChapterAdmin',      N'Chapter administration', N'For chapter officers: approving sign-ups, the officer roster and the join link.',   110, 0)
) AS v(FeatureKey, DisplayName, Description, SortOrder, IsAlwaysOpen)
WHERE NOT EXISTS (SELECT 1 FROM dbo.AppFeature f WHERE f.FeatureKey = v.FeatureKey);
GO

-- Who may change these: National only, through the office permission grid (same pattern
-- as 29_payment_tag_permissions.sql). National's President holds it by default.
IF NOT EXISTS (SELECT 1 FROM dbo.CouncilPermission WHERE PermissionKey = N'AppSettings.Manage')
    INSERT dbo.CouncilPermission (PermissionKey, DisplayName, Description, IsWrite, IsNationalOnly, IsGrantable, RequiresKey, SortOrder, IsActive)
    VALUES (N'AppSettings.Manage', N'Manage app settings',
            N'Change app-wide settings such as the free trial: its length and which features stay open after it ends.',
            1, 1, 1, NULL, 90, 1);
GO
INSERT dbo.CouncilPermissionDefault (CouncilOfficeId, PermissionKey)
SELECT co.CouncilOfficeId, N'AppSettings.Manage'
FROM   dbo.CouncilOffice co
WHERE  co.OfficeName = N'President'
  AND  NOT EXISTS (SELECT 1 FROM dbo.CouncilPermissionDefault d
                   WHERE d.CouncilOfficeId = co.CouncilOfficeId AND d.PermissionKey = N'AppSettings.Manage');
GO

/* ---------- dbo.fn_MemberAccess — the one place the free-trial rule is computed.
   One row per member (Approved/Active, not deleted). Used by usp_MemberAccess_Get for a
   single member and by usp_AppSettings_Get for the "who would be locked" preview, so the
   two can never disagree. Dates are UTC days, same as every membership-year calculation
   in this database. Trial: approved on day D with N trial days -> full use through day
   D+N-1; TrialEndsOn = D+N is the first locked day. ---------- */
CREATE OR ALTER FUNCTION dbo.fn_MemberAccess (@MemberId INT = NULL)
RETURNS TABLE
AS
RETURN
(
    WITH cfg AS (
        SELECT  CAST(SYSUTCDATETIME() AS DATE) AS Today,
                CAST(CASE WHEN MAX(CASE WHEN SettingKey = N'FreeTrial.Enabled' THEN SettingValue END) = N'1'
                          THEN 1 ELSE 0 END AS BIT) AS IsTrialEnabled,
                ISNULL(TRY_CAST(MAX(CASE WHEN SettingKey = N'FreeTrial.Days' THEN SettingValue END) AS INT), 30) AS TrialDays
        FROM    dbo.AppSetting
        WHERE   SettingKey IN (N'FreeTrial.Enabled', N'FreeTrial.Days')
    ),
    yr AS (
        SELECT  cfg.*,
                CASE WHEN cfg.Today > DATEFROMPARTS(YEAR(cfg.Today), 8, 8)
                     THEN YEAR(cfg.Today) ELSE YEAR(cfg.Today) - 1 END AS MembershipYear
        FROM    cfg
    ),
    m AS (
        SELECT  mem.MemberId,
                CAST(COALESCE(mem.ApprovedDate, mem.CreatedDate) AS DATE) AS TrialStartedOn,
                CAST(CASE WHEN lt.ActionType IN (N'Tagged', N'Free') THEN 1 ELSE 0 END AS BIT) AS IsPaid
        FROM    dbo.Member mem
                JOIN dbo.MemberStatus ms ON ms.StatusId = mem.StatusId
                CROSS JOIN yr
                OUTER APPLY (
                    SELECT TOP (1) a.ActionType
                    FROM   dbo.MemberPaymentTagAction a
                    WHERE  a.MemberId = mem.MemberId AND a.MembershipYear = yr.MembershipYear
                    ORDER BY a.PerformedDate DESC, a.MemberPaymentTagActionId DESC
                ) lt
        WHERE   mem.IsDeleted = 0
          AND   ms.StatusName IN (N'Approved', N'Active')
          AND   (@MemberId IS NULL OR mem.MemberId = @MemberId)
    )
    SELECT  m.MemberId,
            yr.IsTrialEnabled,
            yr.TrialDays,
            yr.MembershipYear,
            m.TrialStartedOn,
            DATEADD(DAY, yr.TrialDays, m.TrialStartedOn) AS TrialEndsOn,
            CAST(CASE WHEN DATEADD(DAY, yr.TrialDays, m.TrialStartedOn) > yr.Today
                      THEN DATEDIFF(DAY, yr.Today, DATEADD(DAY, yr.TrialDays, m.TrialStartedOn)) ELSE 0 END AS INT) AS TrialDaysLeft,
            m.IsPaid,
            -- What WOULD happen with the current day count, whether or not the trial is on —
            -- the settings screen's preview needs this before anyone switches it on.
            CAST(CASE WHEN m.IsPaid = 0 AND DATEADD(DAY, yr.TrialDays, m.TrialStartedOn) <= yr.Today
                      THEN 1 ELSE 0 END AS BIT) AS IsTrialOver,
            CAST(CASE WHEN yr.IsTrialEnabled = 1 AND m.IsPaid = 0
                           AND DATEADD(DAY, yr.TrialDays, m.TrialStartedOn) <= yr.Today
                      THEN 1 ELSE 0 END AS BIT) AS IsLocked
    FROM    m CROSS JOIN yr
);
GO
