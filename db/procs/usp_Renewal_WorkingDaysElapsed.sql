/* Working days since submission, skipping weekends and Philippine public holidays.
   This is what arms the escalation ladder. */
CREATE OR ALTER FUNCTION dbo.fn_WorkingDaysBetween (@From DATE, @To DATE)
RETURNS INT
AS
BEGIN
    IF @From IS NULL OR @To IS NULL OR @To < @From RETURN 0;
    DECLARE @Days INT = 0, @D DATE = @From;
    WHILE @D < @To
    BEGIN
        SET @D = DATEADD(DAY, 1, @D);
        IF DATEPART(WEEKDAY, @D) NOT IN (1, 7)   -- assumes DATEFIRST 7 (Sunday)
           AND NOT EXISTS (SELECT 1 FROM dbo.PublicHoliday WHERE HolidayDate = @D)
            SET @Days = @Days + 1;
    END
    RETURN @Days;
END
GO
CREATE OR ALTER PROCEDURE dbo.usp_Renewal_Queue
    @RequestingMemberId INT,
    @CouncilId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET DATEFIRST 7;

    SELECT  r.RenewalId, r.ReferenceNo, r.ChapterId, ch.ChapterName,
            r.MemberCount, r.TotalFee, r.SubmittedDate, r.StatusName,
            dbo.fn_WorkingDaysBetween(CAST(r.SubmittedDate AS DATE),
                                      CAST(SYSUTCDATETIME() AS DATE)) AS WorkingDaysWaiting,
            p.CityWindowDays, p.ProvinceArmsDay, p.RegionArmsDay,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.RenewalPayment rp WHERE rp.RenewalId = r.RenewalId)
                 THEN 1 ELSE 0 END AS IsFeePosted
    FROM    dbo.ChapterRenewal r
            JOIN dbo.Chapter ch ON ch.ChapterId = r.ChapterId
            JOIN dbo.RenewalPeriod p ON p.PeriodId = r.PeriodId
    WHERE   ch.ParentCouncilId = @CouncilId
      AND   r.StatusName IN ('Submitted','Returned')
    ORDER BY r.SubmittedDate;   -- oldest first: waiting time, not arrival order
END
GO
