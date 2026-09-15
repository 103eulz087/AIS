/* Posts one message to an EXISTING Private room. Does NOT lazily create the room —
   unlike usp_ChatMessage_Post's Public-room safety net, a post to a nonexistent or
   foreign private room is rejected outright: the room must already exist via
   usp_ChatRoom_EnsurePrivate first. (A Public room's identity is derived purely from
   @ChapterId, so "create it if missing" is always unambiguous; a Private room's
   identity depends on which two members it's for, which this proc — given only a
   RoomId — has no business inventing.)

   Anti-enumeration, same convention as usp_ChatMessage_PostPrivate's sibling reads: a
   RoomId that doesn't exist, one that exists but isn't Private, and one the caller
   isn't a participant of ALL come back as the same generic 51282 — there is no
   separate "that's actually a public room" message to distinguish them by.

   NO AuditLog WRITE (confirmed decision for this module — see
   db/schema/15_chat_private.sql's header comment and
   usp_ChatRoom_EnsurePrivate's header comment for why). AuditLog is permanent;
   even metadata-only logging of an ordinary private message send (who/when, no body)
   would be a permanent surveillance record of private conversation timing and
   frequency. Room CREATION is still audited elsewhere (usp_ChatRoom_EnsurePrivate) —
   only the ongoing traffic inside an existing room is not.

   Returns the created row in the SAME column shape as usp_ChatMessage_GetHistory's
   per-row columns (so the API can share one DTO across public and private), PLUS
   RecipientMemberId — whichever of the room's two members isn't the sender — so the
   caller can address the SignalR group and enqueue a push notification with no second
   query. FlagCount/HasFlagged/CanSeeRemovedBody/IsDeleted/DeletedDate are hardcoded to
   0/false/false/0/NULL: a private message can never be flagged or soft-deleted by
   ANY existing proc (usp_ChatMessage_Flag and usp_ChatMessage_Delete both resolve
   their target chapter via the room and refuse to act when that chapter is NULL,
   which every private room's ChapterId always is) — this is an invariant of the
   schema, not a fact that happens to be true only for the row this transaction just
   inserted, so it is safe to hardcode rather than select. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_PostPrivate
    @RoomId INT,
    @RequestingMemberId INT,
    @Body NVARCHAR(2000),
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @MemberAId INT, @MemberBId INT;
    SELECT @MemberAId = MemberAId, @MemberBId = MemberBId
    FROM   dbo.ChatRoom
    WHERE  RoomId = @RoomId AND RoomType = 'Private';

    IF @MemberAId IS NULL OR (@RequestingMemberId <> @MemberAId AND @RequestingMemberId <> @MemberBId)
        THROW 51282, 'Not permitted to post to this conversation.', 1;

    IF @Body IS NULL OR LEN(LTRIM(RTRIM(@Body))) = 0
        THROW 51283, 'A message cannot be empty.', 1;

    DECLARE @RecipientMemberId INT = CASE WHEN @RequestingMemberId = @MemberAId THEN @MemberBId ELSE @MemberAId END;

    DECLARE @Inserted TABLE (MessageId INT, SentDate DATETIME2);

    INSERT dbo.ChatMessage (RoomId, SenderId, Body)
    OUTPUT inserted.MessageId, inserted.SentDate INTO @Inserted
    VALUES (@RoomId, @RequestingMemberId, @Body);

    DECLARE @MessageId INT = (SELECT MessageId FROM @Inserted);

    SELECT  cm.MessageId, cm.SenderId, m.GiftName AS SenderGiftName, m.MemberNumber AS SenderMemberNumber,
            cm.Body, cm.SentDate,
            CAST(0 AS BIT) AS IsDeleted,
            CAST(NULL AS DATETIME2) AS DeletedDate,
            CAST(0 AS INT) AS FlagCount,
            CAST(0 AS BIT) AS HasFlagged,
            CAST(0 AS BIT) AS CanSeeRemovedBody,
            @RecipientMemberId AS RecipientMemberId
    FROM    dbo.ChatMessage cm
            JOIN dbo.Member m ON m.MemberId = cm.SenderId
    WHERE   cm.MessageId = @MessageId;
END
GO
