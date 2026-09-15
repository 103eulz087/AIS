/* Records where a member's scroll position is in a Private room — same posture as
   usp_ChatParticipant_MarkRead (db/procs/): a personal UI preference, NOT an
   organizational fact, so this proc writes NO AuditLog row.

   Anti-enumeration (51282): same check, same error, as usp_ChatMessage_PostPrivate.

   Monotonic: LastReadMessageId only ever moves forward — a stale client replaying an
   older cursor can never rewind another session's read position. Upsert is
   race-safe via the same UPDATE-first / INSERT-if-still-missing / catch-the-
   duplicate-key shape as usp_ChatParticipant_MarkRead, because dbo.ChatParticipant's
   primary key is (RoomId, MemberId) regardless of room type. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatParticipant_MarkReadPrivate
    @RoomId INT,
    @RequestingMemberId INT,
    @LastReadMessageId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @MemberAId INT, @MemberBId INT;
    SELECT @MemberAId = MemberAId, @MemberBId = MemberBId
    FROM   dbo.ChatRoom
    WHERE  RoomId = @RoomId AND RoomType = 'Private';

    IF @MemberAId IS NULL OR (@RequestingMemberId <> @MemberAId AND @RequestingMemberId <> @MemberBId)
        THROW 51282, 'Not permitted to update read state for this conversation.', 1;

    BEGIN TRY
        BEGIN TRAN;
            UPDATE dbo.ChatParticipant
            SET    LastReadMessageId = @LastReadMessageId
            WHERE  RoomId = @RoomId AND MemberId = @RequestingMemberId
              AND  (LastReadMessageId IS NULL OR LastReadMessageId < @LastReadMessageId);

            IF @@ROWCOUNT = 0
               AND NOT EXISTS (SELECT 1 FROM dbo.ChatParticipant WHERE RoomId = @RoomId AND MemberId = @RequestingMemberId)
                INSERT dbo.ChatParticipant (RoomId, MemberId, LastReadMessageId)
                VALUES (@RoomId, @RequestingMemberId, @LastReadMessageId);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;

        IF ERROR_NUMBER() IN (2601, 2627)
            UPDATE dbo.ChatParticipant
            SET    LastReadMessageId = @LastReadMessageId
            WHERE  RoomId = @RoomId AND MemberId = @RequestingMemberId
              AND  (LastReadMessageId IS NULL OR LastReadMessageId < @LastReadMessageId);
        ELSE
            THROW;
    END CATCH
END
GO
