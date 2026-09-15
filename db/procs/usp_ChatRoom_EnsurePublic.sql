/* Lazily creates a chapter's Public chat room the first time anyone opens it, and is
   also safe to call every time the chat screen loads (idempotent — an existing room
   is just returned). Serves CLAUDE.md invariant #4 (scoping checked here, never
   assumed from the caller) and, via UX_ChatRoom_PublicPerChapter
   (db/schema/14_chat.sql), the "one Public room per chapter" invariant this module
   introduces.

   Race safety: two members opening the chat room for the very first time at the same
   instant will both find no existing row and both attempt the INSERT. Rather than a
   check-then-insert (racy) or a serializable transaction (expensive at national
   scale — CLAUDE.md "Performance"), this relies on UX_ChatRoom_PublicPerChapter: the
   loser's INSERT hits a unique-key violation, which is caught and treated as "someone
   else just created it, fetch that row" — not an error surfaced to the caller. Only
   the winner writes the AuditLog 'Create' row; the loser returns WasCreated = 0.

   Membership check is deliberately "IsDeleted = 0 and ChapterId matches" only — no
   status/renewal check. Chat is open regardless of renewal state (mirrors
   usp_Announcement_GetForMember's decision) and there is no chat-posting restriction
   based on member status (Lapsed/Suspended/under corrective action) — every active
   member of the chapter may open and use the room, full stop. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatRoom_EnsurePublic
    @ChapterId INT,
    @RequestingMemberId INT,
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51270, 'Not permitted to open this chapter''s chat room.', 1;

    DECLARE @RoomId INT, @WasCreated BIT = 0;

    SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public';

    IF @RoomId IS NULL
    BEGIN
        DECLARE @RoomName NVARCHAR(120) =
            (SELECT CONCAT(ChapterName, N' Chat') FROM dbo.Chapter WHERE ChapterId = @ChapterId);

        BEGIN TRY
            BEGIN TRAN;
                INSERT dbo.ChatRoom (RoomType, ChapterId, RoomName)
                VALUES ('Public', @ChapterId, @RoomName);

                SET @RoomId = SCOPE_IDENTITY();
                SET @WasCreated = 1;

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
                VALUES ('ChatRoom', CAST(@RoomId AS NVARCHAR(40)), 'Create',
                        CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId, @Ip);
            COMMIT;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK;

            /* UX_ChatRoom_PublicPerChapter fired: a concurrent caller created this
               chapter's room in the gap between our SELECT and our INSERT. That is
               success, not an error — fetch the row the other caller just created.
               Any OTHER error is real and is re-thrown. */
            IF ERROR_NUMBER() IN (2601, 2627)
            BEGIN
                SET @WasCreated = 0;
                SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public';
            END
            ELSE
                THROW;
        END CATCH
    END

    SELECT  cr.RoomId, cr.ChapterId, cr.RoomName, c.ChatRetentionMonths AS RetentionMonths,
            @WasCreated AS WasCreated, ISNULL(cp.IsMuted, 0) AS IsMuted
    FROM    dbo.ChatRoom cr
            JOIN dbo.Chapter c ON c.ChapterId = cr.ChapterId
            LEFT JOIN dbo.ChatParticipant cp ON cp.RoomId = cr.RoomId AND cp.MemberId = @RequestingMemberId
    WHERE   cr.RoomId = @RoomId;
END
GO
