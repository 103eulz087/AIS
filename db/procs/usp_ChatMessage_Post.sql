/* Posts one message to a chapter's Public room. Every active member may post — no
   status/renewal restriction (D8): Lapsed is not disciplinary, a member under a
   corrective action is not silenced, and chat is open regardless of renewal state,
   same as the read side (usp_ChatMessage_GetHistory) and usp_Announcement_GetForMember.

   Room resolution: this proc does NOT cross-call usp_ChatRoom_EnsurePublic via EXEC.
   That proc ends in a SELECT, and EXECing it from inside a write proc would push its
   result set out ahead of this proc's own single-row return, breaking a Dapper
   QuerySingle/QueryFirst caller that expects exactly one row shaped like a posted
   message. Instead, the small race-safe "find or create" block is duplicated here —
   same UX_ChatRoom_PublicPerChapter-backed unique-violation handling as
   usp_ChatRoom_EnsurePublic; see that proc's header comment for the reasoning. In
   practice the frontend calls EnsurePublic once when the chat screen opens, so this
   path is a safety net, not the common case.

   Audit (D5, non-negotiable): NewValues carries MessageId, RoomId, ChapterId and
   BodyLength ONLY. The message body itself is NEVER written to AuditLog — AuditLog is
   permanent, chat is meant to purge eventually (Chapter.ChatRetentionMonths), and a
   body that leaked into a permanent table would defeat that purge entirely.

   Returns the created row in the SAME column shape as usp_ChatMessage_GetHistory's
   per-row columns, so the API can broadcast it over SignalR without a second query.

   MENTIONS (@Mentions dbo.IntList, landing in db/schema/15_chat_private.sql's
   dbo.ChatMessageMention). No DEFAULT on @Mentions: T-SQL does not allow a default
   value on a table-valued parameter, so the caller must always pass one, even if
   empty — the Dapper call always supplies at least an empty DataTable. The
   app resolves a mention via a picker (a specific MemberId), never by parsing free
   text on its own — dbo.GiftName has no uniqueness constraint (db/schema/02_members.sql),
   so text alone can never safely be resolved to one member. This proc only VERIFIES a
   claimed mention id, it never invents one. An id is dropped, silently, with no error,
   unless ALL of: (1) it names an active member of the SAME chapter as @ChapterId, (2)
   the literal substring '@' + that member's GiftName actually appears in @Body, (3) it
   is not @RequestingMemberId himself (no self-notification). Matching is
   CASE-INSENSITIVE (plain CHARINDEX against this database's default collation) — a
   deliberate choice, since a mention picker fills in the GiftName exactly, but a
   member editing that text by hand should not have a mention silently fail over
   capitalization. Verified mentions are capped at 10; since dbo.IntList (00_types.sql)
   carries no ordinal/sequence column of its own, "the order they were verified" is
   necessarily the TVP's own ascending-MemberId order (its primary key), NOT
   necessarily the order the caller listed them in @Mentions — documented here so a
   future reader doesn't go looking for order-preservation this type was never built
   to offer.

   TWO RESULT SETS, by design — this is NOT the "don't cross-call a proc that ends in a
   SELECT" problem described above (that rule is about EXECing a DIFFERENT proc from
   inside this one, which pushes an extra, uncoordinated result set in front of this
   proc's own return). This is the proc's OWN single INSERT returning two things about
   itself: 1) the posted message row (unchanged shape from before mentions existed —
   any existing Dapper QuerySingle/QueryFirst caller keeps working untouched); 2) the
   MemberIds that survived verification and were actually recorded in
   ChatMessageMention (zero rows if none did), so the API can notify them without a
   second round trip. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_Post
    @ChapterId INT,
    @RequestingMemberId INT,
    @Body NVARCHAR(2000),
    @Ip NVARCHAR(45) = NULL,
    @Mentions dbo.IntList READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51272, 'Not permitted to post to this chapter''s chat.', 1;

    IF @Body IS NULL OR LEN(LTRIM(RTRIM(@Body))) = 0
        THROW 51277, 'A message cannot be empty.', 1;

    /* Verify claimed mentions BEFORE the room/message transaction below — this is a
       pure read against Member, independent of @RoomId, so there is no reason to do
       it inside the write transaction. Capped at 10, ordered by MemberId ascending
       (see header comment: dbo.IntList has no ordinal column to preserve caller order). */
    DECLARE @VerifiedMentions TABLE (MemberId INT PRIMARY KEY);
    INSERT INTO @VerifiedMentions (MemberId)
    SELECT TOP (10) m.MemberId
    FROM   @Mentions im
           JOIN dbo.Member m ON m.MemberId = im.Value
    WHERE  m.IsDeleted = 0
      AND  m.ChapterId = @ChapterId
      AND  m.MemberId <> @RequestingMemberId
      AND  CHARINDEX(N'@' + m.GiftName, @Body) > 0
    ORDER BY m.MemberId;

    DECLARE @RoomId INT;
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

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
                VALUES ('ChatRoom', CAST(@RoomId AS NVARCHAR(40)), 'Create',
                        CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId, @Ip);
            COMMIT;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK;

            IF ERROR_NUMBER() IN (2601, 2627)
                SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public';
            ELSE
                THROW;
        END CATCH
    END

    DECLARE @Inserted TABLE (MessageId INT, SentDate DATETIME2);
    DECLARE @MessageId INT, @SentDate DATETIME2;

    BEGIN TRAN;
        INSERT dbo.ChatMessage (RoomId, SenderId, Body)
        OUTPUT inserted.MessageId, inserted.SentDate INTO @Inserted
        VALUES (@RoomId, @RequestingMemberId, @Body);

        SELECT @MessageId = MessageId, @SentDate = SentDate FROM @Inserted;

        IF EXISTS (SELECT 1 FROM @VerifiedMentions)
            INSERT dbo.ChatMessageMention (MessageId, MemberId)
            SELECT @MessageId, MemberId FROM @VerifiedMentions;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
        VALUES ('ChatMessage', CAST(@MessageId AS NVARCHAR(40)), 'Post',
                CONCAT(N'{"RoomId":', @RoomId, N',"ChapterId":', @ChapterId,
                       N',"BodyLength":', LEN(@Body), N'}'),
                @RequestingMemberId, @Ip);
    COMMIT;

    SELECT  cm.MessageId, cm.SenderId, m.GiftName AS SenderGiftName, m.MemberNumber AS SenderMemberNumber,
            cm.Body, cm.SentDate, cm.IsDeleted, cm.DeletedDate,
            -- Hardcoded, not computed: a message the sender just posted has been
            -- flagged by nobody and is not deleted, so FlagCount/HasFlagged/
            -- CanSeeRemovedBody are trivially 0 for every row this proc can ever
            -- return — the row is selected inside the SAME transaction as the INSERT,
            -- before any other caller could have a MessageId to flag. FlagCount is
            -- hardcoded (rather than selecting cm.FlagCount, which would also always
            -- be 0 here) as defense-in-depth parity with usp_ChatMessage_GetHistory's
            -- officer-only masking of that same column — see that proc's header
            -- comment. Columns are still present, in the same order as
            -- usp_ChatMessage_GetHistory, so the API can deserialize both into one
            -- shared DTO.
            CAST(0 AS INT) AS FlagCount,
            CAST(0 AS BIT) AS HasFlagged,
            CAST(0 AS BIT) AS CanSeeRemovedBody
    FROM    dbo.ChatMessage cm
            JOIN dbo.Member m ON m.MemberId = cm.SenderId
    WHERE   cm.MessageId = @MessageId;

    -- Result set 2: the verified MemberIds actually recorded as mentions on this
    -- message (empty if none survived verification). See header comment.
    SELECT MemberId FROM @VerifiedMentions ORDER BY MemberId;
END
GO
