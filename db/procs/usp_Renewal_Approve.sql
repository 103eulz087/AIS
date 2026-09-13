/* Council approves. EVERYTHING here is one transaction: member status, credentials,
   seals, the receipt and the audit — or none of it. */
CREATE OR ALTER PROCEDURE dbo.usp_Renewal_Approve
    @RequestingMemberId INT,
    @RenewalId  INT,
    @CouncilId  INT,
    @IsOverride BIT = 0,
    @OverriddenCouncilId INT = NULL,
    @OverrideReason  NVARCHAR(120) = NULL,
    @OverrideRemarks NVARCHAR(600) = NULL,
    @AmountInWords   NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Status NVARCHAR(30), @ChapterId INT, @PeriodId INT, @Total DECIMAL(18,2), @Year INT;
    SELECT @Status = r.StatusName, @ChapterId = r.ChapterId, @PeriodId = r.PeriodId,
           @Total = r.TotalFee, @Year = p.[Year]
    FROM dbo.ChapterRenewal r JOIN dbo.RenewalPeriod p ON p.PeriodId = r.PeriodId
    WHERE r.RenewalId = @RenewalId;

    IF @Status IS NULL THROW 51050, 'Renewal application not found.', 1;
    IF @Status = 'Approved' THROW 51051, 'This application is already approved.', 1;
    IF @Status <> 'Submitted' THROW 51052, 'Only a submitted application can be approved.', 1;

    /* An application cannot be approved while its fee is unposted. */
    IF NOT EXISTS (SELECT 1 FROM dbo.RenewalPayment WHERE RenewalId = @RenewalId)
        THROW 51053, 'The fee for this application has not been posted. Approval is blocked.', 1;

    IF @IsOverride = 1 AND (@OverrideReason IS NULL OR @OverriddenCouncilId IS NULL)
        THROW 51054, 'An override requires a reason and the council being overridden.', 1;

    /* Membership year ends 8 August of the FOLLOWING calendar year. */
    DECLARE @RenewedThrough DATE = DATEFROMPARTS(@Year + 1, 8, 8);

    BEGIN TRAN;
        UPDATE dbo.ChapterRenewal
           SET StatusName = 'Approved', ApprovedByCouncilId = @CouncilId,
               ApprovedByMemberId = @RequestingMemberId, ApprovedDate = SYSUTCDATETIME(),
               IsOverride = @IsOverride, OverriddenCouncilId = @OverriddenCouncilId,
               OverrideReason = @OverrideReason, OverrideRemarks = @OverrideRemarks
         WHERE RenewalId = @RenewalId;

        UPDATE dbo.MemberRenewal SET RenewedThrough = @RenewedThrough
         WHERE RenewalId = @RenewalId AND RenewalStatus IN ('Renewed','Exempt');

        UPDATE m SET m.RenewedThrough = @RenewedThrough
          FROM dbo.Member m
          JOIN dbo.MemberRenewal mr ON mr.MemberId = m.MemberId
         WHERE mr.RenewalId = @RenewalId AND mr.RenewalStatus IN ('Renewed','Exempt');

        /* Reissue credentials so a lapsed card cannot verify as current. */
        UPDATE c SET c.RevokedDate = SYSUTCDATETIME(), c.RevokedBy = @RequestingMemberId
          FROM dbo.MemberCredential c
          JOIN dbo.MemberRenewal mr ON mr.MemberId = c.MemberId
         WHERE mr.RenewalId = @RenewalId AND c.RevokedDate IS NULL;

        INSERT dbo.MemberCredential (MemberId, ExpiryDate)
        SELECT mr.MemberId, CAST(@RenewedThrough AS DATETIME2)
          FROM dbo.MemberRenewal mr
         WHERE mr.RenewalId = @RenewalId AND mr.RenewalStatus IN ('Renewed','Exempt');

        /* Year seal — the collectible. One per member per year. */
        INSERT dbo.MemberSeal (MemberId, [Year], SealType, RenewalId)
        SELECT mr.MemberId, @Year, 'YearSeal', @RenewalId
          FROM dbo.MemberRenewal mr
         WHERE mr.RenewalId = @RenewalId AND mr.RenewalStatus = 'Renewed'
           AND NOT EXISTS (SELECT 1 FROM dbo.MemberSeal s
                           WHERE s.MemberId = mr.MemberId AND s.[Year] = @Year AND s.SealType='YearSeal');

        /* Acknowledgement receipt — one per application. The number is never reused. */
        DECLARE @AR NVARCHAR(30) = CONCAT('AR-', @Year, '-',
            RIGHT('00000' + CAST(NEXT VALUE FOR dbo.AckReceiptSeq AS NVARCHAR(10)), 5));
        INSERT dbo.AckReceipt (ARNumber, RenewalId, IssuedByCouncilId, IssuedByMemberId,
                               Amount, AmountInWords, VerificationCode)
        VALUES (@AR, @RenewalId, @CouncilId, @RequestingMemberId, @Total, @AmountInWords,
                UPPER(LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 8)));

        /* The chapter's remittance leaves its own books. */
        INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                                SourceType, SourceId, CreatedBy)
        VALUES (@ChapterId, CAST(SYSUTCDATETIME() AS DATE), 'Out', @Total,
                CONCAT(N'Annual renewal remittance ', @Year, N' — receipt ', @AR),
                'Remittance', @RenewalId, @RequestingMemberId);

        INSERT dbo.RenewalAction (RenewalId, CouncilId, ActorMemberId, ActionType, Remarks)
        VALUES (@RenewalId, @CouncilId, @RequestingMemberId,
                CASE WHEN @IsOverride = 1 THEN 'Override' ELSE 'Approve' END,
                CASE WHEN @IsOverride = 1
                     THEN CONCAT(N'Approved on override of council #', @OverriddenCouncilId,
                                 N'. Reason: ', @OverrideReason)
                     ELSE N'Approved' END);
    COMMIT;

    SELECT @AR AS ARNumber, @RenewedThrough AS RenewedThrough;
END
GO
