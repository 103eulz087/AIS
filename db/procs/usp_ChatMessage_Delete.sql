/* Soft-deletes ("removes") a chat message. ChapterOfficer or ChapterAdmin of the
   message's OWN chapter only — resolved from the message itself via its room, never
   trusted from a parameter (invariant #4).

   This IS a genuine UPDATE (IsDeleted/DeletedBy/DeletedDate/DeleteReason), not an
   append-only insert. That is correct and intentional, NOT a violation of CLAUDE.md
   invariant #1 — see db/schema/14_chat.sql's header comment #1 for why ChatMessage is
   not LedgerEntry/CorrectiveAction. There is no hard DELETE anywhere in this module,
   for any role including sysadmin, and this proc does not add one.

   Anti-enumeration (same reasoning as usp_Meeting_Get): a message that doesn't exist
   and a message that belongs to a chapter the caller isn't even a member of come back
   as the SAME generic "not found" (51274) — this endpoint cannot be used to probe
   whether a given message id exists somewhere the caller doesn't belong. Only a
   caller who IS a member of the right chapter, but not an officer/admin of it, gets
   the more specific "not permitted" (51273).

   Idempotent: deleting an already-deleted message is a no-op that still returns
   success (DeletedDate/DeletedBy/DeleteReason are NOT overwritten by a second call,
   and NO second AuditLog row is written for it — an audit row for a no-op write would
   misrepresent that something changed).

   Audits the reason via ChatMessage.DeleteReason (a dedicated column) — AuditLog's
   NewValues carries only ChapterId, never the reason text and never the message body,
   matching this codebase's existing pattern of keeping free text in its own column
   rather than re-embedding it as unescaped JSON (see usp_Meeting_Reopen,
   usp_Expense_Void: MeetingReopen.Reason / ExpenseVoid.Reason, not JSON). */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_Delete
    @MessageId INT,
    @RequestingMemberId INT,
    @Reason NVARCHAR(200),
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ChapterId INT, @IsDeleted BIT;

    SELECT @ChapterId = cr.ChapterId, @IsDeleted = cm.IsDeleted
    FROM   dbo.ChatMessage cm
           JOIN dbo.ChatRoom cr ON cr.RoomId = cm.RoomId
    WHERE  cm.MessageId = @MessageId;

    IF @ChapterId IS NULL
        THROW 51274, 'Message not found.', 1;

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
          AND r.RoleName IN ('ChapterOfficer', 'ChapterAdmin')
    )
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
            THROW 51273, 'Only a chapter officer or chapter admin may remove a message.', 1;
        ELSE
            THROW 51274, 'Message not found.', 1;
    END

    IF @IsDeleted = 1
    BEGIN
        -- Already removed. No-op: return current state, write no second audit row.
        SELECT @MessageId AS MessageId, DeletedDate FROM dbo.ChatMessage WHERE MessageId = @MessageId;
        RETURN;
    END

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) = 0
        THROW 51278, 'A reason is required to remove a message.', 1;

    DECLARE @Deleted TABLE (DeletedDate DATETIME2);

    BEGIN TRAN;
        UPDATE dbo.ChatMessage
        SET    IsDeleted = 1,
               DeletedBy = @RequestingMemberId,
               DeletedDate = SYSUTCDATETIME(),
               DeleteReason = @Reason
        OUTPUT inserted.DeletedDate INTO @Deleted
        WHERE  MessageId = @MessageId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
        VALUES ('ChatMessage', CAST(@MessageId AS NVARCHAR(40)), 'Delete',
                CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId, @Ip);
    COMMIT;

    SELECT @MessageId AS MessageId, DeletedDate FROM @Deleted;
END
GO
