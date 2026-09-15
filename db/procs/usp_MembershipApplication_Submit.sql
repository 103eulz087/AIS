/* Public, unauthenticated sign-up. No account exists yet — @PerformedBy on the audit row
   is NULL by design (there is no actor to attribute this to), exactly like a chapter
   registration form (§7A.4) before anyone has signed in.

   Double-submit handling: an applicant who taps "submit" twice (a slow connection, an
   impatient thumb) should get HIS OWN reference number back, not a cryptic constraint
   error. UX_MembershipApplication_Open (db/schema/10_membership_applications.sql) is the
   server-side guard against a duplicate OPEN application for the same (chapter, mobile);
   this proc wraps the insert in TRY/CATCH and, on a unique-violation, looks up and returns
   the existing row's ReferenceNo instead of raising. A plain pre-check-then-insert would
   leave a race window between two truly concurrent submits; catching the constraint
   violation itself does not. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_Submit
    @ChapterId    INT,
    @FirstName    NVARCHAR(80),
    @MiddleName   NVARCHAR(80) = NULL,
    @LastName     NVARCHAR(80),
    @GiftName     NVARCHAR(60),
    @BirthDate    DATE,
    @MobileNo     NVARCHAR(30),
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

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId AND IsActive = 1)
        THROW 51216, 'Chapter not found or not accepting applications.', 1;

    IF @BirthDate IS NULL OR @BirthDate >= CAST(SYSUTCDATETIME() AS DATE)
        THROW 51217, 'Birthdate must be a real date in the past.', 1;

    DECLARE @PendingApprovalId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'PendingApproval');
    DECLARE @ReturnedId        INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'ReturnedForCorrection');

    DECLARE @ApplicationId INT, @ReferenceNo NVARCHAR(20);
    DECLARE @Year INT = YEAR(SYSUTCDATETIME());

    BEGIN TRY
        BEGIN TRAN;
            SET @ReferenceNo = CONCAT('APP-', @Year, '-',
                RIGHT('00000' + CAST(NEXT VALUE FOR dbo.MembershipApplicationSeq AS NVARCHAR(10)), 5));

            INSERT dbo.MembershipApplication (
                ReferenceNo, ChapterId, FirstName, MiddleName, LastName, GiftName, BirthDate,
                MobileNo, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
                SeconderNameGiven, SeconderMemberNumberGiven, StatusId, IsOpen)
            VALUES (
                @ReferenceNo, @ChapterId, @FirstName, @MiddleName, @LastName, @GiftName, @BirthDate,
                @MobileNo, @Email, @DateSurvive, @PresidentDuringSurvive, @MasterInitiatorDuringSurvive,
                @SeconderNameGiven, @SeconderMemberNumberGiven, @PendingApprovalId, 1);

            SET @ApplicationId = SCOPE_IDENTITY();

            INSERT dbo.MembershipApplicationUpdate (ApplicationId, UpdatedBy, StatusId, Notes)
            VALUES (@ApplicationId, NULL, @PendingApprovalId, N'Submitted.');

            /* No authenticated actor exists yet — PerformedBy NULL is expected here, not a bug. */
            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('MembershipApplication', CAST(@ApplicationId AS NVARCHAR(40)), 'Submit',
                    CONCAT(N'{"ChapterId":', @ChapterId, N',"ReferenceNo":"', @ReferenceNo, N'"}'),
                    NULL);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;

        /* 2601/2627: unique-index / unique-constraint violation — the only error this
           catch is written to handle. Anything else is a real failure and must surface. */
        IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;

        SELECT TOP (1) @ReferenceNo = ReferenceNo
        FROM   dbo.MembershipApplication
        WHERE  ChapterId = @ChapterId AND MobileNo = @MobileNo
          AND  StatusId IN (@PendingApprovalId, @ReturnedId)
        ORDER BY SubmittedDate DESC;
    END CATCH

    SELECT @ReferenceNo AS ReferenceNo;
END
GO
