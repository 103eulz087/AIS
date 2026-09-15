/* An applicant corrects and resubmits an application a chapter admin sent back. There is
   still no account — @ReferenceNo + @MobileNo is the same "both must match" credential
   usp_MembershipApplication_GetByReference uses, and for the same reason: the single
   combined lookup below cannot tell a caller whether the reference or the mobile was
   wrong, only that the pair together did not resolve to a row.

   ChapterId and MobileNo are NOT editable here — MobileNo is half of the lookup identity
   this proc is keyed by, and letting it change out from under that key is a separate
   concern this slice does not take on. Every other short-form field can be corrected. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_Resubmit
    @ReferenceNo NVARCHAR(20),
    @MobileNo    NVARCHAR(30),
    @FirstName    NVARCHAR(80),
    @MiddleName   NVARCHAR(80) = NULL,
    @LastName     NVARCHAR(80),
    @GiftName     NVARCHAR(60),
    @BirthDate    DATE,
    @Email        NVARCHAR(200) = NULL,
    @DateSurvive  DATE = NULL,
    @PresidentDuringSurvive       NVARCHAR(200) = NULL,
    @MasterInitiatorDuringSurvive NVARCHAR(200) = NULL,
    @SeconderNameGiven         NVARCHAR(160),
    @SeconderMemberNumberGiven NVARCHAR(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @BirthDate IS NULL OR @BirthDate >= CAST(SYSUTCDATETIME() AS DATE)
        THROW 51220, 'Birthdate must be a real date in the past.', 1;

    DECLARE @ApplicationId INT, @StatusId INT;
    SELECT @ApplicationId = ApplicationId, @StatusId = StatusId
    FROM   dbo.MembershipApplication
    WHERE  ReferenceNo = @ReferenceNo AND MobileNo = @MobileNo;

    IF @ApplicationId IS NULL
        THROW 51218, 'Application not found.', 1;

    DECLARE @ReturnedId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'ReturnedForCorrection');
    DECLARE @PendingId  INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'PendingApproval');

    IF @StatusId <> @ReturnedId
        THROW 51219, 'Only an application returned for correction can be resubmitted.', 1;

    BEGIN TRAN;
        UPDATE dbo.MembershipApplication
           SET FirstName = @FirstName, MiddleName = @MiddleName, LastName = @LastName,
               GiftName = @GiftName, BirthDate = @BirthDate, Email = @Email,
               DateSurvive = @DateSurvive, PresidentDuringSurvive = @PresidentDuringSurvive,
               MasterInitiatorDuringSurvive = @MasterInitiatorDuringSurvive,
               SeconderNameGiven = @SeconderNameGiven,
               SeconderMemberNumberGiven = @SeconderMemberNumberGiven,
               StatusId = @PendingId, IsOpen = 1
         WHERE ApplicationId = @ApplicationId;

        /* UpdatedBy NULL — the applicant has no account, so there is no authenticated
           actor to record here, same reasoning as usp_MembershipApplication_Submit. */
        INSERT dbo.MembershipApplicationUpdate (ApplicationId, UpdatedBy, StatusId, Notes)
        VALUES (@ApplicationId, NULL, @PendingId, N'Resubmitted by applicant after correction.');

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MembershipApplication', CAST(@ApplicationId AS NVARCHAR(40)), 'Resubmit',
                N'{}', NULL);
    COMMIT;

    SELECT @ApplicationId AS ApplicationId, @ReferenceNo AS ReferenceNo, @PendingId AS StatusId;
END
GO
