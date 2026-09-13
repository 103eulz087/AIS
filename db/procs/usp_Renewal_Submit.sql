/* Chapter president submits the annual renewal.
   The roster comes from AIS; this only records who is Renewed | Lapsed | Exempt. */
CREATE OR ALTER PROCEDURE dbo.usp_Renewal_Submit
    @RequestingMemberId INT,
    @ChapterId INT,
    @PeriodId  INT,
    @Rows      dbo.RenewalRow READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId)
        THROW 51040, 'Not permitted to submit for this chapter.', 1;

    DECLARE @Fee DECIMAL(18,2), @IsOpen BIT, @Closes DATE, @Grace DATE, @LateFee DECIMAL(18,2);
    SELECT @Fee = FeePerMember, @IsOpen = IsOpen, @Closes = ClosesDate,
           @Grace = GraceEndsDate, @LateFee = LateFeePerMember
    FROM dbo.RenewalPeriod WHERE PeriodId = @PeriodId;

    IF @IsOpen = 0 THROW 51041, 'The renewal season is not open.', 1;
    IF CAST(SYSUTCDATETIME() AS DATE) > @Grace THROW 51042, 'The grace period has ended.', 1;

    /* Late fee applies only after the season closes, during grace. */
    DECLARE @Effective DECIMAL(18,2) =
        @Fee + CASE WHEN CAST(SYSUTCDATETIME() AS DATE) > @Closes THEN @LateFee ELSE 0 END;

    DECLARE @Renewing INT = (SELECT COUNT(*) FROM @Rows WHERE RenewalStatus = 'Renewed');

    BEGIN TRAN;
        DECLARE @RenewalId INT, @Ref NVARCHAR(30);

        SELECT @RenewalId = RenewalId FROM dbo.ChapterRenewal
         WHERE ChapterId = @ChapterId AND PeriodId = @PeriodId AND StatusName <> 'Returned';

        IF @RenewalId IS NULL
        BEGIN
            SET @Ref = CONCAT('RNW-', (SELECT [Year] FROM dbo.RenewalPeriod WHERE PeriodId=@PeriodId),
                              '-', RIGHT('0000' + CAST(NEXT VALUE FOR dbo.RenewalRefSeq AS NVARCHAR(10)), 4));
            INSERT dbo.ChapterRenewal (ReferenceNo, ChapterId, PeriodId, SubmittedBy, SubmittedDate,
                                       MemberCount, TotalFee, StatusName)
            VALUES (@Ref, @ChapterId, @PeriodId, @RequestingMemberId, SYSUTCDATETIME(),
                    @Renewing, @Renewing * @Effective, 'Submitted');
            SET @RenewalId = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.ChapterRenewal
               SET SubmittedBy = @RequestingMemberId, SubmittedDate = SYSUTCDATETIME(),
                   MemberCount = @Renewing, TotalFee = @Renewing * @Effective,
                   StatusName = 'Submitted'
             WHERE RenewalId = @RenewalId AND StatusName IN ('Draft','Returned','Submitted');
            DELETE dbo.MemberRenewal WHERE RenewalId = @RenewalId;
        END

        INSERT dbo.MemberRenewal (RenewalId, MemberId, RenewalStatus, FeeAmount)
        SELECT @RenewalId, r.MemberId, r.RenewalStatus,
               CASE WHEN r.RenewalStatus = 'Renewed' THEN @Effective ELSE 0 END
        FROM   @Rows r
        JOIN   dbo.Member m ON m.MemberId = r.MemberId AND m.ChapterId = @ChapterId;

        INSERT dbo.RenewalAction (RenewalId, ActorMemberId, ActionType, Remarks)
        VALUES (@RenewalId, @RequestingMemberId, 'Submit',
                CONCAT(@Renewing, N' members declared for renewal'));
    COMMIT;

    SELECT RenewalId, ReferenceNo, MemberCount, TotalFee, StatusName
    FROM dbo.ChapterRenewal WHERE RenewalId = @RenewalId;
END
GO
