/* One meeting, in full. Any member of the meeting's own chapter may read it —
   membership in another chapter is rejected with the SAME "not found" message as a
   nonexistent id, so this endpoint cannot be used to probe which meeting ids exist
   in someone else's chapter.

   Three result sets:
     1. The meeting header, plus the ledger entry it posted (if any) and whether
        that entry has since been reversed (a live reopen would have reversed it).
     2. The attendance sheet: every ACTIVE member of the chapter, LEFT JOINed to his
        MeetingAttendance row for THIS meeting. A member with no row comes back with
        NULL AttendanceStatusId/FundAmount — "not recorded", not "absent". The caller
        decides how to render that; this proc only tells the truth.
        NOTHING here is aggregated per member across meetings.
     3. The MeetingReopen correction trail, oldest first, visible to every member —
        transparency requires the whole chapter can see when and why a finalized
        meeting was reopened, not just the officers who did it. */
CREATE OR ALTER PROCEDURE dbo.usp_Meeting_Get
    @MeetingId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId FROM dbo.Meeting WHERE MeetingId = @MeetingId;

    IF @ChapterId IS NULL
        THROW 51159, 'Meeting not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51159, 'Meeting not found.', 1;

    /* Most recent original (non-reversal) posting for this meeting, if any. */
    DECLARE @LedgerEntryId INT;
    SELECT TOP (1) @LedgerEntryId = le.LedgerEntryId
    FROM   dbo.LedgerEntry le
    WHERE  le.SourceType = 'Meeting' AND le.SourceId = @MeetingId AND le.IsReversal = 0
    ORDER BY le.LedgerEntryId DESC;

    -- 1. Header
    SELECT  mt.MeetingId, mt.ChapterId, mt.Subject, mt.MeetingDate, mt.Body, mt.Location,
            mt.IsFinalized, mt.FinalizedBy, mt.FinalizedDate, mt.CreatedBy, mt.CreatedDate,
            @LedgerEntryId AS LedgerEntryId,
            CAST(CASE WHEN @LedgerEntryId IS NOT NULL
                  AND EXISTS (SELECT 1 FROM dbo.LedgerEntry r WHERE r.ReversesEntryId = @LedgerEntryId)
                 THEN 1 ELSE 0 END AS BIT) AS LedgerEntryIsReversed
    FROM    dbo.Meeting mt
    WHERE   mt.MeetingId = @MeetingId;

    -- 2. Attendance sheet — no per-member cross-meeting aggregation, ever.
    SELECT  m.MemberId, m.GiftName, m.MemberNumber, ms.StatusName,
            ma.AttendanceStatusId, ma.FundAmount, ma.CheckedInAt
    FROM    dbo.Member m
            JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId
            LEFT JOIN dbo.MeetingAttendance ma
                   ON ma.MeetingId = @MeetingId AND ma.MemberId = m.MemberId
    WHERE   m.ChapterId = @ChapterId AND m.IsDeleted = 0
    ORDER BY m.GiftName;

    -- 3. Reopen / correction history
    SELECT  mr.MeetingReopenId, mr.ReopenedBy, mr.ReopenedDate, mr.Reason, mr.ReversedLedgerEntryId
    FROM    dbo.MeetingReopen mr
    WHERE   mr.MeetingId = @MeetingId
    ORDER BY mr.ReopenedDate ASC, mr.MeetingReopenId ASC;
END
GO
