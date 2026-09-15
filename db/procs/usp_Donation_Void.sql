/* Voids a donation — the only way to correct one. ChapterAdmin ONLY; same reasoning as
   usp_Expense_Void's role choice (see its header comment) — usp_Donation_Create already
   sits at Treasurer/Admin, so void narrows one step further.

   Skips usp_Ledger_Reverse entirely when the donation was in-kind (no ledger entry was
   ever posted for it) — mirrors usp_Meeting_Reopen's branch for a zero-total meeting.
   No IsVoided column on dbo.Donation: "was this donation voided" is answered by
   dbo.DonationVoid's existence, exactly as usp_Expense_Void reuses Expense.IsDeleted
   but Donation had no equivalent column to reuse — see db/schema/09_expenses_donations.sql
   design note 4. */
CREATE OR ALTER PROCEDURE dbo.usp_Donation_Void
    @DonationId INT,
    @Reason     NVARCHAR(400),
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51208, 'A reason of at least 10 characters is required — it will be shown to the whole chapter.', 1;

    DECLARE @ChapterId INT, @Amount DECIMAL(18,2), @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @Amount = Amount FROM dbo.Donation WHERE DonationId = @DonationId;

    IF @ChapterId IS NULL THROW 51206, 'Donation not found.', 1;
    IF EXISTS (SELECT 1 FROM dbo.DonationVoid WHERE DonationId = @DonationId)
        THROW 51207, 'This donation has already been voided.', 1;

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
        THROW 51209, 'Only the chapter admin may void a donation.', 1;

    /* The live (unreversed) original posting for this donation, if one exists.
       An in-kind-only donation (Amount = 0) has none — nothing to reverse. */
    DECLARE @LiveLedgerEntryId INT;
    SELECT TOP (1) @LiveLedgerEntryId = le.LedgerEntryId
    FROM   dbo.LedgerEntry le
    WHERE  le.SourceType = 'Donation' AND le.SourceId = @DonationId AND le.IsReversal = 0
      AND  NOT EXISTS (SELECT 1 FROM dbo.LedgerEntry rv WHERE rv.ReversesEntryId = le.LedgerEntryId)
    ORDER BY le.LedgerEntryId DESC;

    DECLARE @ReversedLedgerEntryId INT = NULL;
    DECLARE @ReverseResult TABLE (NewLedgerEntryId INT);

    BEGIN TRAN;
        IF @LiveLedgerEntryId IS NOT NULL
        BEGIN
            INSERT INTO @ReverseResult (NewLedgerEntryId)
            EXEC dbo.usp_Ledger_Reverse
                @LedgerEntryId      = @LiveLedgerEntryId,
                @Reason             = @Reason,
                @PerformedBy        = @RequestingMemberId,
                @RequestingMemberId = @RequestingMemberId,
                @NewLedgerEntryId   = @ReversedLedgerEntryId OUTPUT;
        END
        -- else: in-kind donation, nothing was ever posted. Still voided, reason still recorded.

        INSERT dbo.DonationVoid (DonationId, VoidedBy, Reason, ReversedLedgerEntryId)
        VALUES (@DonationId, @RequestingMemberId, @Reason, @ReversedLedgerEntryId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Donation', CAST(@DonationId AS NVARCHAR(40)), 'Void',
                CONCAT(N'{"ReversedLedgerEntryId":',
                       ISNULL(CAST(@ReversedLedgerEntryId AS NVARCHAR(20)), N'null'), N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @DonationId AS DonationId, @ReversedLedgerEntryId AS ReversedLedgerEntryId;
END
GO
