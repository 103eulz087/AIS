/* Records where a member's scroll position is in the chapter's Public room — a
   personal UI preference, NOT an organizational fact. Per the confirmed design
   decision for this module, this proc writes NO AuditLog row: marking a room "read"
   carries no more organizational weight than which tab a member last had open, and
   auditing it would just be noise in a permanent table for a fact nobody but the
   member himself ever needs.

   dbo.ChatParticipant is read-state/preference storage only — see db/schema/14_chat.sql
   header comment #3. It plays NO role in deciding whether @RequestingMemberId may read
   or post; that is (and always is) Member.ChapterId = ChatRoom.ChapterId, which is why
   the membership check below exists even though this proc never returns chat content.

   Monotonic: LastReadMessageId only ever moves forward. A stale client replaying an
   older cursor (e.g. a slow tab catching up after a fast one already marked read
   further along) can never rewind another session's read position.

   If the chapter's Public room has never been created (nobody has opened chat yet),
   there is nothing to have read — a no-op, not an error. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatParticipant_MarkRead
    @ChapterId INT,
    @RequestingMemberId INT,
    @LastReadMessageId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51279, 'Not permitted to update read state for this chapter''s chat.', 1;

    DECLARE @RoomId INT;
    SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public';

    IF @RoomId IS NULL
        RETURN; -- nothing has ever been posted; nothing to mark read.

    -- UPDATE-first, INSERT-if-still-missing, with the INSERT's duplicate-key error
    -- caught and folded back into the monotonic UPDATE: two calls for the same member
    -- racing (e.g. two open tabs marking read within the same instant) can otherwise
    -- both find no existing row and both attempt the INSERT against the (RoomId,
    -- MemberId) primary key. This is the same "unique-violation is not an error, it's
    -- proof someone else just did it" shape as usp_ChatRoom_EnsurePublic, applied to a
    -- much lower-stakes race.
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
