/* The moderation queue: every message in a chapter's Public room that has ever been
   flagged. Officer-only (ChapterOfficer or ChapterAdmin of @ChapterId) — this is the
   one place in the module where a deleted message's Body IS returned regardless of
   IsDeleted, because this screen only exists for officers in the first place; there is
   no non-officer path into this proc for usp_ChatMessage_GetHistory's body-withholding
   rule to apply to.

   @IncludeResolved = 0 (default) shows only messages that still have at least one
   OPEN flag (ResolvedDate IS NULL) — the working queue. = 1 also shows messages whose
   flags have all been resolved, for an officer reviewing history.

   Ordered oldest-open-flag-first: a message with a flag that has been sitting open
   the longest surfaces at the top of the default queue, ahead of one flagged five
   minutes ago. Fully-resolved messages (shown only when @IncludeResolved = 1) sort
   after every message with an open flag, since they have no open-flag age to sort by.

   Two result sets, by design (documented here so the shape doesn't need re-deriving
   from the SQL): 1) one row per flagged message, paged; 2) one row per (message,
   flagger) pair for JUST the messages in that page — the flagger's gift name and the
   reason they gave, so the officer screen can show "flagged by TANGLAW: spam" under
   each message without a second round trip per row. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_GetFlagged
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50,
    @IncludeResolved BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF NOT EXISTS (
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
    )
        THROW 51276, 'Only a chapter officer or chapter admin may view the moderation queue.', 1;

    DECLARE @RoomId INT;
    SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public';

    DECLARE @Page TABLE (
        Seq                 INT IDENTITY(1,1) PRIMARY KEY,
        MessageId           INT,
        SenderId            INT,
        SenderGiftName      NVARCHAR(150),
        SenderMemberNumber  NVARCHAR(30),
        Body                NVARCHAR(2000),
        SentDate            DATETIME2,
        IsDeleted           BIT,
        FlagCount           INT,
        OpenFlagCount       INT,
        TotalCount          INT
    );

    ;WITH Flagged AS (
        SELECT  cm.MessageId, cm.SenderId, m.GiftName AS SenderGiftName, m.MemberNumber AS SenderMemberNumber,
                cm.Body, cm.SentDate, cm.IsDeleted, cm.FlagCount,
                (SELECT COUNT(*) FROM dbo.ChatMessageFlag f
                 WHERE f.MessageId = cm.MessageId AND f.ResolvedDate IS NULL) AS OpenFlagCount,
                (SELECT MIN(f.FlaggedDate) FROM dbo.ChatMessageFlag f
                 WHERE f.MessageId = cm.MessageId AND f.ResolvedDate IS NULL) AS OldestOpenFlagDate
        FROM    dbo.ChatMessage cm
                JOIN dbo.Member m ON m.MemberId = cm.SenderId
        WHERE   cm.RoomId = @RoomId
          AND   EXISTS (SELECT 1 FROM dbo.ChatMessageFlag f WHERE f.MessageId = cm.MessageId)
    )
    INSERT INTO @Page (MessageId, SenderId, SenderGiftName, SenderMemberNumber, Body, SentDate,
                        IsDeleted, FlagCount, OpenFlagCount, TotalCount)
    SELECT  MessageId, SenderId, SenderGiftName, SenderMemberNumber, Body, SentDate,
            IsDeleted, FlagCount, OpenFlagCount, COUNT(*) OVER()
    FROM    Flagged
    WHERE   (@IncludeResolved = 1 OR OpenFlagCount > 0)
    ORDER BY CASE WHEN OpenFlagCount > 0 THEN 0 ELSE 1 END,
             ISNULL(OldestOpenFlagDate, '9999-12-31') ASC,
             MessageId ASC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;

    -- Result set 1: the page of flagged messages.
    SELECT MessageId, SenderId, SenderGiftName, SenderMemberNumber, Body, SentDate,
           IsDeleted, FlagCount, OpenFlagCount, TotalCount
    FROM   @Page
    ORDER BY Seq;

    -- Result set 2: every flag on every message in THIS page — not the whole chapter's
    -- flag history, just what's needed to render the page returned above.
    SELECT  p.MessageId, f.MemberId, mm.GiftName AS FlaggerGiftName, f.Reason,
            f.FlaggedDate, f.ResolvedDate, f.ResolvedBy
    FROM    @Page p
            JOIN dbo.ChatMessageFlag f ON f.MessageId = p.MessageId
            JOIN dbo.Member mm ON mm.MemberId = f.MemberId
    ORDER BY p.Seq, f.FlaggedDate ASC;
END
GO
