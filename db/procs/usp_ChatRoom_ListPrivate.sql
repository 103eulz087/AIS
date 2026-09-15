/* Lists the caller's private conversations, newest-activity-first — the "DM inbox"
   screen. Scoping (invariant #4) is implicit and complete here: the Rooms CTE below
   only ever considers rooms where @RequestingMemberId IS ONE OF THE TWO PARTICIPANTS
   (MemberAId or MemberBId), so there is no separate permission check to bypass — a
   room simply cannot appear in this result for anyone else, by construction of the
   WHERE clause, the same way UX_ChatRoom_PrivatePair makes the pair itself
   race-safe rather than relying on an application-level check.

   Only conversations with AT LEAST ONE MESSAGE are returned — a room can exist (via
   usp_ChatRoom_EnsurePrivate) before either side has said anything, and an empty inbox
   entry for a DM nobody has used yet would just be noise. This is why the "last
   message" lookup below is a CROSS APPLY (not OUTER APPLY): CROSS APPLY naturally
   drops any room whose subquery returns zero rows.

   LastMessagePreview is NULL when the latest message is soft-deleted. In practice this
   can never happen for a Private room today — see usp_ChatMessage_Delete's header
   comment on why a private room (ChapterId always NULL) is unmoderatable by the
   existing delete proc — but the column is still computed defensively rather than
   assumed, so this proc keeps working correctly if that ever changes.

   UnreadCount counts messages strictly after the caller's own LastReadMessageId
   (dbo.ChatParticipant, resolved per-room for @RequestingMemberId) that were NOT sent
   by the caller himself — his own messages never count as "unread" to him. A caller
   with no ChatParticipant row yet (never marked anything read in this room) is treated
   as having read nothing (LastReadMessageId defaults to 0 via ISNULL), so every
   message from the other side counts. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatRoom_ListPrivate
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH Rooms AS (
        SELECT  cr.RoomId,
                CASE WHEN cr.MemberAId = @RequestingMemberId THEN cr.MemberBId ELSE cr.MemberAId END AS OtherMemberId
        FROM    dbo.ChatRoom cr
        WHERE   cr.RoomType = 'Private'
          AND   (cr.MemberAId = @RequestingMemberId OR cr.MemberBId = @RequestingMemberId)
    ),
    Joined AS (
        SELECT  r.RoomId,
                r.OtherMemberId,
                om.GiftName AS OtherGiftName,
                c.ChapterName AS OtherChapterName,
                lm.MessageId AS LastMessageId,
                CASE WHEN lm.IsDeleted = 1 THEN NULL ELSE LEFT(lm.Body, 80) END AS LastMessagePreview,
                lm.SentDate AS LastMessageDate,
                ISNULL(uc.UnreadCount, 0) AS UnreadCount,
                ISNULL(cp.IsMuted, CAST(0 AS BIT)) AS IsMuted
        FROM    Rooms r
                JOIN dbo.Member om ON om.MemberId = r.OtherMemberId
                LEFT JOIN dbo.Chapter c ON c.ChapterId = om.ChapterId
                CROSS APPLY (
                    SELECT TOP (1) cm.MessageId, cm.Body, cm.SentDate, cm.IsDeleted
                    FROM   dbo.ChatMessage cm
                    WHERE  cm.RoomId = r.RoomId
                    ORDER BY cm.MessageId DESC
                ) lm
                LEFT JOIN dbo.ChatParticipant cp ON cp.RoomId = r.RoomId AND cp.MemberId = @RequestingMemberId
                OUTER APPLY (
                    SELECT COUNT(*) AS UnreadCount
                    FROM   dbo.ChatMessage cm2
                    WHERE  cm2.RoomId = r.RoomId
                      AND  cm2.MessageId > ISNULL(cp.LastReadMessageId, 0)
                      AND  cm2.SenderId <> @RequestingMemberId
                ) uc
    )
    SELECT  RoomId, OtherMemberId, OtherGiftName, OtherChapterName,
            LastMessageId, LastMessagePreview, LastMessageDate,
            UnreadCount, IsMuted,
            COUNT(*) OVER() AS TotalCount
    FROM    Joined
    ORDER BY LastMessageDate DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
