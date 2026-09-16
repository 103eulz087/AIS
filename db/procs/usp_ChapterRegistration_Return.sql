/* Sends a registration back for correction — §7A.4: "An unverified officer means the
   form is returned with a remark, not approved-and-corrected-later." Reason required,
   same >=10-character bar this codebase uses everywhere a reason is shown to the person
   on the other end (usp_Meeting_Reopen, usp_MembershipApplication_Return,
   usp_Donation_Void, usp_Expense_Void, usp_Announcement_Withdraw).

   Either verifying role may return it (CouncilSecretary or CouncilAdmin) — the same bar
   as usp_ChapterRegistration_VerifyOfficer, since a return is simply "verification
   failed, tell them why," not the separate, narrower final-approval capability.

   Stays open (IsOpen remains 1): a returned registration still occupies its
   chapter-turnover or municipality/proposed-name slot until it is corrected and
   resubmitted — same idiom as usp_MembershipApplication_Return.

   Clears every officer's verification tick: the roster is about to change, so nobody
   stays approved-by-default against a roster the council may no longer recognise once
   it comes back. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_Return
    @RegistrationId INT,
    @RequestingMemberId INT,
    @Reason NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51550, 'A reason of at least 10 characters is required — it will be shown to the chapter.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ActingCouncilId INT, @StatusId INT;

    SELECT @ActingCouncilId = ActingCouncilId, @StatusId = StatusId
    FROM   dbo.ChapterRegistration WHERE RegistrationId = @RegistrationId;

    IF @ActingCouncilId IS NULL
        THROW 51551, 'Registration not found.', 1;

    DECLARE @SubmittedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Submitted');
    IF @StatusId <> @SubmittedId
        THROW 51552, 'This registration has already been decided, or is not awaiting a decision.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr
        JOIN   dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName IN ('CouncilSecretary', 'CouncilAdmin')
    )
        THROW 51553, 'Only this council''s Secretary or President may return this registration.', 1;

    DECLARE @ReturnedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'ReturnedForCorrection');

    BEGIN TRAN;
        UPDATE dbo.ChapterRegistration
           SET StatusId = @ReturnedId, IsOpen = 1,
               DecidedBy = @RequestingMemberId, DecidedDate = SYSUTCDATETIME(), DecisionReason = @Reason
         WHERE RegistrationId = @RegistrationId;

        UPDATE dbo.ChapterRegistrationOfficer
           SET VerifiedBy = NULL, VerifiedDate = NULL, VerifyNote = NULL
         WHERE RegistrationId = @RegistrationId;

        INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
        VALUES (@RegistrationId, @RequestingMemberId, @ReturnedId, @Reason);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('ChapterRegistration', CAST(@RegistrationId AS NVARCHAR(40)), 'Return',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;

    SELECT @RegistrationId AS RegistrationId, @ReturnedId AS StatusId;
END
GO
