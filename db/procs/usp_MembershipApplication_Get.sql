/* One application, in full, for the chapter admin reviewing it. Same anti-enumeration
   shape as usp_Meeting_Get: a nonexistent application id and an application that belongs
   to some OTHER chapter come back with the exact same "not found" message and error
   code, so this endpoint cannot be used to probe which application ids exist in a chapter
   this caller does not administer.

   Three result sets:
     1. The application itself, in full — including the seconder's free-text answer and
        whatever SeconderMemberId (if any) has already been resolved.
     2. Its own status-change history (MembershipApplicationUpdate), oldest first — the
        submitted → returned → resubmitted → approved timeline.
     3. Prior CLOSED applications (Approved / Rejected) from the SAME mobile number, most
        recent first, so a repeat applicant is never invisible to the reviewer — this is
        the applicant's own history, not another member's data, so it is not restricted
        by CLAUDE.md invariant #7 (that invariant is about existing MEMBERS' cross-chapter
        data, not an applicant's own prior applications). Deliberately not limited to this
        chapter: a chapter admin ought to see that the same phone number was rejected by
        another chapter last year. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_Get
    @ApplicationId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChapterId INT, @MobileNo NVARCHAR(30), @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @MobileNo = MobileNo
    FROM   dbo.MembershipApplication WHERE ApplicationId = @ApplicationId;

    IF @ChapterId IS NULL
        THROW 51222, 'Application not found.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role   r ON r.RoleId = mr.RoleId
        JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName = 'ChapterAdmin'
    )
        THROW 51222, 'Application not found.', 1;

    -- 1. The application, in full.
    SELECT  a.ApplicationId, a.ReferenceNo, a.ChapterId, a.FirstName, a.MiddleName, a.LastName,
            a.GiftName, a.BirthDate, a.MobileNo, a.Email, a.DateSurvive,
            a.PresidentDuringSurvive, a.MasterInitiatorDuringSurvive,
            a.SeconderNameGiven, a.SeconderMemberNumberGiven, a.SeconderMemberId,
            sm.GiftName AS SeconderResolvedGiftName, sm.MemberNumber AS SeconderResolvedMemberNumber,
            a.StatusId, s.StatusName, a.SubmittedDate,
            a.DecidedBy, a.DecidedDate, a.DecisionReason, a.CreatedMemberId
    FROM    dbo.MembershipApplication a
            JOIN dbo.MembershipApplicationStatus s ON s.StatusId = a.StatusId
            LEFT JOIN dbo.Member sm ON sm.MemberId = a.SeconderMemberId
    WHERE   a.ApplicationId = @ApplicationId;

    -- 2. Status-change history, oldest first.
    SELECT  u.MembershipApplicationUpdateId, u.UpdateDate, u.UpdatedBy, u.StatusId, s.StatusName, u.Notes
    FROM    dbo.MembershipApplicationUpdate u
            JOIN dbo.MembershipApplicationStatus s ON s.StatusId = u.StatusId
    WHERE   u.ApplicationId = @ApplicationId
    ORDER BY u.UpdateDate ASC, u.MembershipApplicationUpdateId ASC;

    -- 3. This applicant's own prior CLOSED applications, most recent first.
    SELECT  a2.ApplicationId, a2.ReferenceNo, a2.ChapterId, ch.ChapterName,
            a2.StatusId, s2.StatusName, a2.SubmittedDate, a2.DecidedDate, a2.DecisionReason
    FROM    dbo.MembershipApplication a2
            JOIN dbo.MembershipApplicationStatus s2 ON s2.StatusId = a2.StatusId
            JOIN dbo.Chapter ch ON ch.ChapterId = a2.ChapterId
    WHERE   a2.MobileNo = @MobileNo
      AND   a2.ApplicationId <> @ApplicationId
      AND   a2.IsOpen = 0
    ORDER BY a2.SubmittedDate DESC;
END
GO
