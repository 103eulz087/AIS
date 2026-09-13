/* Membership year 2027: 09 Aug 2027 → 08 Aug 2028. Named by the year it OPENS. */
SET NOCOUNT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.RenewalPeriod WHERE [Year] = 2027)
INSERT dbo.RenewalPeriod ([Year], OpensDate, ClosesDate, GraceEndsDate,
                          FeePerMember, LateFeePerMember,
                          CityWindowDays, ProvinceArmsDay, RegionArmsDay, IsOpen)
VALUES (2027, '2027-05-01', '2027-08-08', '2027-10-08', 50.00, 25.00, 10, 10, 20, 1);

DECLARE @P INT = (SELECT PeriodId FROM dbo.RenewalPeriod WHERE [Year] = 2027);

/* PROPOSED split — the percentages are a National Council decision.
   PurposeText is shown to members: a brother accepts ₱50 when he can see what it funds. */
MERGE dbo.FeeSplit AS t USING (VALUES
 ('National',      40.00, 'National programs, portal and AIS hosting, national ID issuance'),
 ('Regional',      30.00, 'Regional activities and council operations'),
 ('Provincial',    20.00, 'Provincial activities and oversight'),
 ('City/Municipal',10.00, 'Local council operations and chapter support')
) AS s(LevelName, Pct, Purpose)
ON t.PeriodId = @P AND t.CouncilLevelId = (SELECT CouncilLevelId FROM dbo.CouncilLevel WHERE LevelName = s.LevelName)
WHEN NOT MATCHED THEN
INSERT (PeriodId, CouncilLevelId, SharePercent, PurposeText)
VALUES (@P, (SELECT CouncilLevelId FROM dbo.CouncilLevel WHERE LevelName = s.LevelName), s.Pct, s.Purpose);
GO
