/* Reports ("flags") a message for officer review. Any active member of the message's
   own chapter may flag — no officer gate on raising a flag, only on resolving one
   (usp_ChatMessage_ResolveFlags) or viewing the queue (usp_ChatMessage_GetFlagged).

   Anti-enumeration, same shape as usp_ChatMessage_Delete: a nonexistent message and a
   message in a chapter the caller doesn't belong to both come back as the single
   generic 51275 — there is no separate "wrong chapter" message to distinguish them by.

   dbo.ChatMessageFlag's primary key (MessageId, MemberId) — see db/schema/14_chat.sql
   — is what makes "one flag per member per message" a database guarantee, not an
   application convention: a second flag from the same member on the same message is a
   silent no-op here, never an error, and writes no second AuditLog row (nothing
   actually changed).

   FlagCount is recomputed as COUNT(*) of ALL flags ever raised for the message —
   never decremented, even after usp_ChatMessage_ResolveFlags closes them out. A flag
   once raised is a permanent fact about the message's history, not a live "currently
   flagged" gauge; OpenFlagCount (usp_ChatMessage_GetFlagged) is the live gauge. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_Flag
    @MessageId INT,
    @RequestingMemberId INT,
    @Reason NVARCHAR(200) = NULL,
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ChapterId INT;
    SELECT @ChapterId = cr.ChapterId
    FROM   dbo.ChatMessage cm
           JOIN dbo.ChatRoom cr ON cr.RoomId = cm.RoomId
    WHERE  cm.MessageId = @MessageId;

    IF @ChapterId IS NULL
       OR NOT EXISTS (SELECT 1 FROM dbo.Member
                      WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51275, 'Message not found.', 1;

    BEGIN TRAN;
        IF NOT EXISTS (SELECT 1 FROM dbo.ChatMessageFlag
                       WHERE MessageId = @MessageId AND MemberId = @RequestingMemberId)
        BEGIN
            INSERT dbo.ChatMessageFlag (MessageId, MemberId, Reason)
            VALUES (@MessageId, @RequestingMemberId, @Reason);

            UPDATE dbo.ChatMessage
            SET    FlagCount = (SELECT COUNT(*) FROM dbo.ChatMessageFlag WHERE MessageId = @MessageId)
            WHERE  MessageId = @MessageId;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
            VALUES ('ChatMessage', CAST(@MessageId AS NVARCHAR(40)), 'Flag',
                    CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId, @Ip);
        END
        -- else: this member already flagged this message. Silent no-op, no audit row.
    COMMIT;

    SELECT @MessageId AS MessageId, FlagCount FROM dbo.ChatMessage WHERE MessageId = @MessageId;
END
GO
