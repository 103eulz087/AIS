/* Voids an expense — the only way to correct one; there is no update and no hard delete.
   ChapterAdmin ONLY, narrower than usp_Expense_Create's Treasurer/Admin: usp_Expense_Create
   already sits at the Treasurer/Admin bar docs §3.1 sets for money-recording, so
   narrowing void one step further the way usp_Meeting_Reopen narrows relative to
   usp_Meeting_SaveAttendance (Officer/Admin -> Treasurer/Admin) means going to Admin
   alone — an irreversible correction to money already posted AND already disclosed to
   the whole chapter's ledger is the kind of action this codebase reserves for the
   chapter's most accountable officer. (usp_Ledger_Reverse itself only requires
   Treasurer/Admin; Admin-only here is strictly narrower and still satisfies that check.)

   One transaction: reverse the live ledger entry via usp_Ledger_Reverse (INSERT...EXEC +
   OUTPUT param, same pattern as usp_Meeting_Reopen), soft-hide the expense
   (IsDeleted = 1 — the column already existed on dbo.Expense), record the reason in
   dbo.ExpenseVoid, audit. UI word is "Void" throughout — never "delete". */
CREATE OR ALTER PROCEDURE dbo.usp_Expense_Void
    @ExpenseId INT,
    @Reason    NVARCHAR(400),
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51198, 'A reason of at least 10 characters is required — it will be shown to the whole chapter.', 1;

    DECLARE @ChapterId INT, @IsDeleted BIT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @ChapterId = ChapterId, @IsDeleted = IsDeleted
    FROM dbo.Expense WHERE ExpenseId = @ExpenseId;

    IF @ChapterId IS NULL THROW 51196, 'Expense not found.', 1;
    IF @IsDeleted = 1 THROW 51197, 'This expense has already been voided.', 1;

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
        THROW 51199, 'Only the chapter admin may void an expense.', 1;

    /* The live (unreversed) original posting for this expense, if one exists — it always
       should, since usp_Expense_Create posts unconditionally when @Amount > 0 (which it
       must always be — see usp_Expense_Create's @Amount <= 0 check). */
    DECLARE @LiveLedgerEntryId INT;
    SELECT TOP (1) @LiveLedgerEntryId = le.LedgerEntryId
    FROM   dbo.LedgerEntry le
    WHERE  le.SourceType = 'Expense' AND le.SourceId = @ExpenseId AND le.IsReversal = 0
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

        UPDATE dbo.Expense SET IsDeleted = 1 WHERE ExpenseId = @ExpenseId;

        INSERT dbo.ExpenseVoid (ExpenseId, VoidedBy, Reason, ReversedLedgerEntryId)
        VALUES (@ExpenseId, @RequestingMemberId, @Reason, @ReversedLedgerEntryId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Expense', CAST(@ExpenseId AS NVARCHAR(40)), 'Void',
                CONCAT(N'{"ReversedLedgerEntryId":',
                       ISNULL(CAST(@ReversedLedgerEntryId AS NVARCHAR(20)), N'null'), N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @ExpenseId AS ExpenseId, @ReversedLedgerEntryId AS ReversedLedgerEntryId;
END
GO
