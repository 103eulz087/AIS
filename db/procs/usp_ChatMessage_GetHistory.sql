/* Keyset-paginated chat history for a chapter's Public room, newest first. Pages on
   MessageId (IDENTITY, monotonic) rather than SentDate — see IX_ChatMessage_Room_Id
   (db/schema/14_chat.sql) for why SentDate is the wrong shape for this access pattern.

   Scoping (invariant #4): the caller must actually be an active, undeleted member of
   @ChapterId — checked here, never assumed from an upstream token claim. Same
   "IsDeleted = 0, chapter matches, no status/renewal check" shape as
   usp_ChatRoom_EnsurePublic — chat is open to every active member regardless of
   Lapsed/Suspended/corrective-action status (D8) and regardless of renewal state
   (mirrors usp_Announcement_GetForMember).

   Officer status is resolved from MemberRole for the CALLER, inside this proc — same
   pattern as usp_Announcement_Create's officer check — never taken from a parameter,
   so a client can't simply pass "I'm an officer" to unlock removed message bodies.

   CRITICAL (moderation confidentiality): for a row where IsDeleted = 1, Body comes
   back NULL unless the caller is an officer of THIS chapter. This withholding happens
   HERE, in the proc, never left to the API or the frontend to filter after the fact —
   a client-side filter is not a security boundary. CanSeeRemovedBody tells the caller
   whether it is an officer so the UI can render "message removed" correctly, but it
   is a hint, not a decision the client makes: the Body is genuinely absent in the
   result for a non-officer, not merely hidden by the UI.

   SAME pattern, same reason, applied to FlagCount: how many members have flagged a
   message is a moderation signal for officers, not a public tally for the general
   membership — see ChatEndpoints.cs's MessageFlagged SignalR broadcast, which already
   goes to the chapter-{id}-officers group only. A non-officer caller gets FlagCount =
   0 regardless of the true count, using the exact same @IsOfficer check computed above
   for CanSeeRemovedBody. HasFlagged is NOT masked — it reports whether THIS caller
   personally flagged the message, which is his own action and stays accurate for
   every caller regardless of role. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_GetHistory
    @ChapterId INT,
    @RequestingMemberId INT,
    @BeforeMessageId INT = NULL,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51271, 'Not permitted to read this chapter''s chat.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @RoomId INT;
    SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public';

    DECLARE @IsOfficer BIT = CAST((CASE WHEN EXISTS (
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
    ) THEN 1 ELSE 0 END) AS BIT);

    -- @RoomId may be NULL if the room has never been created yet (nobody has posted).
    -- "cm.RoomId = NULL" is never true, so this simply returns zero rows — correct,
    -- not an error: no room means no history.
    SELECT TOP (@Take)
            cm.MessageId, cm.SenderId, m.GiftName AS SenderGiftName, m.MemberNumber AS SenderMemberNumber,
            CASE WHEN cm.IsDeleted = 1 AND @IsOfficer = 0 THEN NULL ELSE cm.Body END AS Body,
            cm.SentDate, cm.IsDeleted, cm.DeletedDate,
            CASE WHEN @IsOfficer = 1 THEN cm.FlagCount ELSE 0 END AS FlagCount,
            CAST(CASE WHEN f.MessageId IS NULL THEN 0 ELSE 1 END AS BIT) AS HasFlagged,
            @IsOfficer AS CanSeeRemovedBody
    FROM    dbo.ChatMessage cm
            JOIN dbo.Member m ON m.MemberId = cm.SenderId
            LEFT JOIN dbo.ChatMessageFlag f
                   ON f.MessageId = cm.MessageId AND f.MemberId = @RequestingMemberId
    WHERE   cm.RoomId = @RoomId
      AND   (@BeforeMessageId IS NULL OR cm.MessageId < @BeforeMessageId)
    ORDER BY cm.MessageId DESC;
END
GO
