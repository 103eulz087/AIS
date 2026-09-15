/* THE ONLY way a corrective action's status ever changes. ChapterAdmin only, scoped to
   the CASE'S OWN chapter (looked up from the case, never trusted from the caller —
   CLAUDE.md invariant #4).

   Never touches CorrectiveAction.Content — that narrative is written once, by
   usp_CorrectiveAction_File, and this proc has no parameter and no statement that
   could rewrite it. A correction or elaboration is a NEW row here, in
   CorrectiveActionUpdate, exactly as CLAUDE.md invariant #1's reversing-entry pattern
   works for the ledger — never an edit of what was already said.

   One transaction: append the new CorrectiveActionUpdate row (the append-only history
   — see TR_CorrectiveActionUpdate_NoUpdateDelete in db/schema/12_corrective_actions.sql),
   then project the case's StatusName/ResolutionNotes/ResolutionDate columns from that
   latest row — a read-optimised summary of the history, never a second source of truth.

   "Resolving" status = Reconciled or Dismissed — the two states in docs §4.5's four-
   value set that mean the case is no longer open. Moving TO one of those stamps
   ResolutionDate/ResolutionNotes; moving AWAY from one (a case reopened back to Pending
   or Under Review) clears both, since a case that is open again is not "resolved as of"
   some earlier date — CorrectiveAction's columns describe its CURRENT state, and the
   full "it used to say Reconciled, then was reopened" story lives in the timeline this
   proc appends to, not in the header. */
CREATE OR ALTER PROCEDURE dbo.usp_CorrectiveAction_AddUpdate
    @CaseId INT,
    @RequestingMemberId INT,
    @NewStatusName NVARCHAR(20),
    @Notes NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId FROM dbo.CorrectiveAction WHERE CaseId = @CaseId;

    IF @ChapterId IS NULL
        THROW 51253, 'Corrective action not found.', 1;

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
          AND r.RoleName   = 'ChapterAdmin'
    )
        THROW 51254, 'Only the chapter admin may update a corrective action.', 1;

    IF @NewStatusName NOT IN ('Pending', 'Under Review', 'Reconciled', 'Dismissed')
        THROW 51255, 'Unrecognised status. Use Pending, Under Review, Reconciled or Dismissed.', 1;

    DECLARE @IsResolving BIT = CASE WHEN @NewStatusName IN ('Reconciled', 'Dismissed') THEN 1 ELSE 0 END;

    BEGIN TRAN;
        INSERT dbo.CorrectiveActionUpdate (CaseId, UpdatedBy, StatusName, Notes)
        VALUES (@CaseId, @RequestingMemberId, @NewStatusName, @Notes);

        UPDATE dbo.CorrectiveAction
           SET StatusName      = @NewStatusName,
               ResolutionNotes = CASE WHEN @IsResolving = 1 THEN @Notes END,
               ResolutionDate  = CASE WHEN @IsResolving = 1 THEN @Today END
         WHERE CaseId = @CaseId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('CorrectiveAction', CAST(@CaseId AS NVARCHAR(40)), 'Update',
                CONCAT(N'{"StatusName":"', @NewStatusName, N'"}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @CaseId AS CaseId, @NewStatusName AS StatusName;
END
GO
