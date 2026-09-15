/* Records a donation and — only when cash actually moved — posts it to the ledger in
   the SAME transaction. Like an expense, a donation is an event that already happened
   (the gift is already in hand); there is no draft/finalize step.

   ChapterTreasurer or ChapterAdmin only (docs §3.1). A donation must be cash, goods, or
   both, never neither — enforced here with a clear THROW (defence in depth alongside
   dbo.CK_Donation_CashOrKind, so a plain constraint-violation error never reaches the
   UI) and again by the constraint itself if this check is ever bypassed.

   In-kind donations (Amount = 0, InKindDescription populated) post NOTHING to the ledger
   — CK_Ledger_Amount correctly forbids a zero-amount ledger row, and a sack of rice is
   real without ever being a peso figure. @NewLedgerEntryId comes back NULL in that case. */
CREATE OR ALTER PROCEDURE dbo.usp_Donation_Create
    @ChapterId INT,
    @RequestingMemberId INT,
    @DonorName   NVARCHAR(200),
    @DonorTypeId INT = NULL,
    @Amount      DECIMAL(18,2) = 0,
    @InKindDescription NVARCHAR(400) = NULL,
    @ChapterReceiptNo  NVARCHAR(60) = NULL,
    @ActivityId  INT = NULL,
    @Notes       NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE), @DonationDate DATE = CAST(SYSUTCDATETIME() AS DATE);

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
          AND r.RoleName IN ('ChapterTreasurer', 'ChapterAdmin')
    )
        THROW 51202, 'Only the chapter treasurer or chapter admin may record a donation.', 1;

    IF ISNULL(@Amount, 0) <= 0 AND @InKindDescription IS NULL
        THROW 51203, 'A donation must record a cash amount, an in-kind description, or both.', 1;

    IF @DonorTypeId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.DonorType WHERE DonorTypeId = @DonorTypeId)
        THROW 51204, 'Unrecognised donor type.', 1;

    IF @ActivityId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.Activity WHERE ActivityId = @ActivityId AND ChapterId = @ChapterId
    )
        THROW 51205, 'Activity not found for this chapter.', 1;

    DECLARE @DonationId INT, @NewLedgerEntryId INT = NULL;

    BEGIN TRAN;
        INSERT dbo.Donation (ChapterId, ActivityId, DonationDate, DonorName, DonorType, DonorTypeId,
                              Subject, Body, Amount, InKindDescription, ChapterReceiptNo, RecordedBy)
        SELECT @ChapterId, @ActivityId, @DonationDate, @DonorName,
               (SELECT TypeName FROM dbo.DonorType WHERE DonorTypeId = @DonorTypeId),
               @DonorTypeId, NULL, @Notes, ISNULL(@Amount, 0), @InKindDescription, @ChapterReceiptNo,
               @RequestingMemberId;

        SET @DonationId = SCOPE_IDENTITY();

        IF ISNULL(@Amount, 0) > 0
        BEGIN
            INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                                    SourceType, SourceId, ActivityId, CreatedBy)
            VALUES (@ChapterId, @DonationDate, 'In', @Amount,
                    CONCAT(N'Donation — ', @DonorName), 'Donation', @DonationId, @ActivityId, @RequestingMemberId);

            SET @NewLedgerEntryId = SCOPE_IDENTITY();
        END

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Donation', CAST(@DonationId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"Amount":', ISNULL(@Amount, 0),
                       N',"LedgerEntryId":', ISNULL(CAST(@NewLedgerEntryId AS NVARCHAR(20)), N'null'), N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @DonationId AS DonationId, @NewLedgerEntryId AS LedgerEntryId;
END
GO
