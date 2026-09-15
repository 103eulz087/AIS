/* Rejects an application. ChapterAdmin only, reason required — same shape as
   usp_MembershipApplication_Return, terminal instead of reopened: IsOpen flips to 0 and
   the (chapter, mobile) slot frees up for a fresh application. Never deletes anything —
   the row, and its full history, stays forever. Rejecting an already-decided application
   throws; there is no un-reject and no re-reject. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_Reject
    @ApplicationId INT,
    @RequestingMemberId INT,
    @Reason NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51233, 'A reason of at least 10 characters is required — it will be shown to the applicant.', 1;

    DECLARE @ChapterId INT, @StatusId INT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @StatusId = StatusId
    FROM   dbo.MembershipApplication WHERE ApplicationId = @ApplicationId;

    IF @ChapterId IS NULL
        THROW 51234, 'Application not found.', 1;

    DECLARE @PendingApprovalId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'PendingApproval');
    IF @StatusId <> @PendingApprovalId
        THROW 51235, 'This application has already been decided.', 1;

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
        THROW 51236, 'Only the chapter admin may decide this application.', 1;

    DECLARE @RejectedId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'Rejected');

    BEGIN TRAN;
        UPDATE dbo.MembershipApplication
           SET StatusId = @RejectedId, IsOpen = 0,
               DecidedBy = @RequestingMemberId, DecidedDate = SYSUTCDATETIME(),
               DecisionReason = @Reason
         WHERE ApplicationId = @ApplicationId;

        INSERT dbo.MembershipApplicationUpdate (ApplicationId, UpdatedBy, StatusId, Notes)
        VALUES (@ApplicationId, @RequestingMemberId, @RejectedId, @Reason);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MembershipApplication', CAST(@ApplicationId AS NVARCHAR(40)), 'Reject',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;

    SELECT @ApplicationId AS ApplicationId, @RejectedId AS StatusId;
END
GO
