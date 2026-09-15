/* Paged meeting list for a chapter. Any member of the chapter may read it.
   Shape matches usp_Ledger_GetByChapter: COUNT(*) OVER() for TotalCount, newest first.

   CollectionTotal is the ONLY permitted FundAmount aggregate here — the sum for a
   SINGLE meeting, never across meetings, and never broken down per member. No
   arrears, no per-brother total, ever (CLAUDE.md invariant #5 / decision 3). */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_GetByChapter
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51158, 'Not permitted to read this chapter''s meetings.', 1;

    SELECT  mt.MeetingId, mt.Subject, mt.MeetingDate, mt.Location, mt.IsFinalized,
            mt.FinalizedDate,
            ISNULL(a.CollectionTotal, 0) AS CollectionTotal,
            ISNULL(a.PresentCount, 0)    AS PresentCount,
            ISNULL(a.LateCount, 0)       AS LateCount,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Meeting mt
            OUTER APPLY (
                SELECT SUM(ma.FundAmount) AS CollectionTotal,
                       SUM(CASE WHEN s.StatusName = 'Present' THEN 1 ELSE 0 END) AS PresentCount,
                       SUM(CASE WHEN s.StatusName = 'Late'    THEN 1 ELSE 0 END) AS LateCount
                FROM   dbo.MeetingAttendance ma
                       JOIN dbo.AttendanceStatus s ON s.AttendanceStatusId = ma.AttendanceStatusId
                WHERE  ma.MeetingId = mt.MeetingId
            ) a
    WHERE   mt.ChapterId = @ChapterId
    ORDER BY mt.MeetingDate DESC, mt.MeetingId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
