/* Sets (or clears) mute on a room for the calling member. Serves BOTH room types —
   the first real writer dbo.ChatParticipant.IsMuted has ever had (it shipped in
   db/schema/14_chat.sql with no writer at all; see that file's header comment #3).

   Permission check branches on the room's actual RoomType, resolved here, never
   trusted from a parameter (invariant #4):
     - Public:  caller must be an active (IsDeleted = 0) member of the room's
                ChapterId — same membership test as every other Public-room proc.
     - Private: caller must be MemberAId or MemberBId of the room.
   Both branches throw the SAME 51284 on failure ("not permitted to mute/unmute this
   conversation") — the caller-facing meaning is identical either way, so there is no
   value in a room-type-specific message, and a room that doesn't exist at all also
   lands on 51284 (RoomType comes back NULL, which satisfies neither branch).

   No AuditLog write — muting is a personal preference, same posture as
   usp_ChatParticipant_MarkRead/MarkReadPrivate, and was never audited even before
   this proc existed to write it.

   Upsert is race-safe: UPDATE first, INSERT only if no row exists yet, with the
   INSERT's duplicate-key error (two tabs setting mute for the same room at the same
   instant) folded back into the UPDATE — same shape as
   usp_ChatParticipant_MarkRead/MarkReadPrivate, minus the monotonic guard (IsMuted has
   no "only moves forward" rule; the caller's most recent call always wins). */
CREATE OR ALTER PROCEDURE dbo.usp_ChatParticipant_SetMute
    @RoomId INT,
    @RequestingMemberId INT,
    @IsMuted BIT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @RoomType NVARCHAR(10), @ChapterId INT, @MemberAId INT, @MemberBId INT;
    SELECT  @RoomType = RoomType, @ChapterId = ChapterId, @MemberAId = MemberAId, @MemberBId = MemberBId
    FROM    dbo.ChatRoom
    WHERE   RoomId = @RoomId;

    IF @RoomType IS NULL
        THROW 51284, 'Not permitted to change the mute setting for this conversation.', 1;

    IF @RoomType = 'Public'
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
            THROW 51284, 'Not permitted to change the mute setting for this conversation.', 1;
    END
    ELSE -- Private
    BEGIN
        IF @RequestingMemberId <> @MemberAId AND @RequestingMemberId <> @MemberBId
            THROW 51284, 'Not permitted to change the mute setting for this conversation.', 1;
    END

    BEGIN TRY
        BEGIN TRAN;
            UPDATE dbo.ChatParticipant
            SET    IsMuted = @IsMuted
            WHERE  RoomId = @RoomId AND MemberId = @RequestingMemberId;

            IF @@ROWCOUNT = 0
                INSERT dbo.ChatParticipant (RoomId, MemberId, IsMuted)
                VALUES (@RoomId, @RequestingMemberId, @IsMuted);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;

        IF ERROR_NUMBER() IN (2601, 2627)
            UPDATE dbo.ChatParticipant
            SET    IsMuted = @IsMuted
            WHERE  RoomId = @RoomId AND MemberId = @RequestingMemberId;
        ELSE
            THROW;
    END CATCH
END
GO
