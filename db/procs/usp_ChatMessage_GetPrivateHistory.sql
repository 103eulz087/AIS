/* Keyset-paginated history for a Private room, newest first — same pattern as
   usp_ChatMessage_GetHistory (pages on MessageId, IDENTITY and monotonic, not
   SentDate; see IX_ChatMessage_Room_Id, db/schema/14_chat.sql).

   Anti-enumeration (51282): a RoomId that doesn't exist, one that exists but is
   Public, and one the caller isn't a participant of all come back the same way — see
   usp_ChatMessage_PostPrivate's header comment, which uses the identical check.

   Column shape matches usp_ChatMessage_PostPrivate's return, minus RecipientMemberId
   (not needed for a history read — every row already carries SenderId, and the
   "other" member is whoever isn't the caller, which the caller already knows).
   FlagCount/HasFlagged/CanSeeRemovedBody/IsDeleted/DeletedDate are hardcoded for the
   same reason as usp_ChatMessage_PostPrivate: no existing proc can ever flag or
   soft-delete a message in a room whose ChapterId is NULL, which every Private room's
   is, unconditionally — so this holds for every row in the result, not merely the one
   most recently inserted. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_GetPrivateHistory
    @RoomId INT,
    @RequestingMemberId INT,
    @BeforeMessageId INT = NULL,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MemberAId INT, @MemberBId INT;
    SELECT @MemberAId = MemberAId, @MemberBId = MemberBId
    FROM   dbo.ChatRoom
    WHERE  RoomId = @RoomId AND RoomType = 'Private';

    IF @MemberAId IS NULL OR (@RequestingMemberId <> @MemberAId AND @RequestingMemberId <> @MemberBId)
        THROW 51282, 'Not permitted to read this conversation.', 1;

    SELECT TOP (@Take)
            cm.MessageId, cm.SenderId, m.GiftName AS SenderGiftName, m.MemberNumber AS SenderMemberNumber,
            cm.Body, cm.SentDate,
            CAST(0 AS BIT) AS IsDeleted,
            CAST(NULL AS DATETIME2) AS DeletedDate,
            CAST(0 AS INT) AS FlagCount,
            CAST(0 AS BIT) AS HasFlagged,
            CAST(0 AS BIT) AS CanSeeRemovedBody
    FROM    dbo.ChatMessage cm
            JOIN dbo.Member m ON m.MemberId = cm.SenderId
    WHERE   cm.RoomId = @RoomId
      AND   (@BeforeMessageId IS NULL OR cm.MessageId < @BeforeMessageId)
    ORDER BY cm.MessageId DESC;
END
GO
