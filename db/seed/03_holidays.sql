/* Philippine regular holidays. The escalation clock counts WORKING days,
   so a chapter submitting before Holy Week must not be unfairly escalated.
   Movable feasts and proclaimed special days must be added each year. */
SET NOCOUNT ON;
MERGE dbo.PublicHoliday AS t USING (VALUES
 ('2027-01-01','New Year''s Day'),
 ('2027-04-09','Araw ng Kagitingan'),
 ('2027-05-01','Labor Day'),
 ('2027-06-12','Independence Day'),
 ('2027-08-30','National Heroes Day'),
 ('2027-11-30','Bonifacio Day'),
 ('2027-12-25','Christmas Day'),
 ('2027-12-30','Rizal Day')
) AS s(HolidayDate,HolidayName) ON t.HolidayDate = s.HolidayDate
WHEN NOT MATCHED THEN INSERT (HolidayDate,HolidayName) VALUES (s.HolidayDate,s.HolidayName);
GO
