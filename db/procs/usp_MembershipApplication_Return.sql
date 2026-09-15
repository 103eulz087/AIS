/* Sends an application back for correction. ChapterAdmin only, reason required — same
   ≥10-character bar this codebase uses everywhere a reason is shown to someone
   (usp_Meeting_Reopen, usp_Donation_Void, usp_Expense_Void, usp_Announcement_Withdraw).
   Stays open (IsOpen remains 1 — see db/schema/10_membership_applications.sql design
   note 2): a returned application still occupies its chapter/mobile slot until the
   applicant resubmits or the admin instead rejects it outright. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_Return
    @ApplicationId INT,
    @RequestingMemberId INT,
    @Reason NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51229, 'A reason of at least 10 characters is required — it will be shown to the applicant.', 1;

    DECLARE @ChapterId INT, @StatusId INT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @StatusId = StatusId
    FROM   dbo.MembershipApplication WHERE ApplicationId = @ApplicationId;

    IF @ChapterId IS NULL
        THROW 51230, 'Application not found.', 1;

    DECLARE @PendingApprovalId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'PendingApproval');
    IF @StatusId <> @PendingApprovalId
        THROW 51231, 'This application has already been decided, or is not awaiting a decision.', 1;

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
        THROW 51232, 'Only the chapter admin may decide this application.', 1;

    DECLARE @ReturnedId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'ReturnedForCorrection');

    BEGIN TRAN;
        UPDATE dbo.MembershipApplication
           SET StatusId = @ReturnedId, IsOpen = 1,
               DecidedBy = @RequestingMemberId, DecidedDate = SYSUTCDATETIME(),
               DecisionReason = @Reason
         WHERE ApplicationId = @ApplicationId;

        INSERT dbo.MembershipApplicationUpdate (ApplicationId, UpdatedBy, StatusId, Notes)
        VALUES (@ApplicationId, @RequestingMemberId, @ReturnedId, @Reason);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MembershipApplication', CAST(@ApplicationId AS NVARCHAR(40)), 'Return',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;

    SELECT @ApplicationId AS ApplicationId, @ReturnedId AS StatusId;
END
GO
