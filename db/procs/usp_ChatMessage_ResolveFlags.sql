/* Closes out every currently-open flag on a message. Officer-only on the message's
   own chapter — reuses the EXACT permission check and anti-enumeration shape as
   usp_ChatMessage_Delete (51273 not permitted, 51274 not found/wrong chapter merged);
   see that proc's header comment for the reasoning.

   "Currently open" = ResolvedDate IS NULL. Stamps ResolvedDate/ResolvedBy on those
   rows only; a flag already resolved earlier is left untouched (its original
   ResolvedDate/ResolvedBy stand).

   Deliberately does NOT touch ChatMessage.FlagCount — FlagCount only ever grows
   (usp_ChatMessage_Flag), because a flag once raised is a permanent fact even after
   the case behind it is closed. Resolving flags is a moderation-queue action, not an
   erasure of the message's flag history. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatMessage_ResolveFlags
    @MessageId INT,
    @RequestingMemberId INT,
    @Note NVARCHAR(200) = NULL,
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ChapterId INT;

    SELECT @ChapterId = cr.ChapterId
    FROM   dbo.ChatMessage cm
           JOIN dbo.ChatRoom cr ON cr.RoomId = cm.RoomId
    WHERE  cm.MessageId = @MessageId;

    IF @ChapterId IS NULL
        THROW 51274, 'Message not found.', 1;

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
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
            THROW 51273, 'Only a chapter officer or chapter admin may resolve flags on a message.', 1;
        ELSE
            THROW 51274, 'Message not found.', 1;
    END

    DECLARE @ResolvedCount INT;

    BEGIN TRAN;
        UPDATE dbo.ChatMessageFlag
        SET    ResolvedDate = SYSUTCDATETIME(),
               ResolvedBy   = @RequestingMemberId
        WHERE  MessageId = @MessageId
          AND  ResolvedDate IS NULL;

        SET @ResolvedCount = @@ROWCOUNT;

        -- @Note is free text, unlike the rest of this JSON blob's fields — STRING_ESCAPE
        -- keeps it from corrupting the JSON (or being misread as JSON structure) the way
        -- a bare CONCAT of user-entered text would.
        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
        VALUES ('ChatMessage', CAST(@MessageId AS NVARCHAR(40)), 'ResolveFlags',
                CONCAT(N'{"ChapterId":', @ChapterId, N',"ResolvedCount":', @ResolvedCount,
                       N',"Note":', ISNULL(N'"' + STRING_ESCAPE(@Note, 'json') + N'"', N'null'), N'}'),
                @RequestingMemberId, @Ip);
    COMMIT;

    SELECT @MessageId AS MessageId, @ResolvedCount AS ResolvedCount;
END
GO
