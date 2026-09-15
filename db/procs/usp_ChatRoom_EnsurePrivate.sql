/* Lazily creates (or returns the existing) Private room for a pair of members, and is
   safe to call every time a member opens a DM thread — same "find or create, idempotent"
   shape as usp_ChatRoom_EnsurePublic (db/procs/), applied to a pair instead of a chapter.

   SAME-CHAPTER ONLY TO START (confirmed decision, docs §4.2): a member may only START a
   private conversation with another member of his OWN chapter. Both members must be
   active (IsDeleted = 0), have a non-null ChapterId, and share that ChapterId. This
   proc is the ONLY place that check runs. A detached, council-homed member (ChapterId
   NULL) cannot be named as @OtherMemberId here, nor call this proc himself, to START a
   new conversation — his home is a council, and cross-chapter/council contact goes
   through the Chapter Admin, not chat. All of this collapses into ONE generic 51280,
   anti-enumeration, same convention as the public module: a caller cannot tell "that
   member doesn't exist", "he's in a different chapter" and "he has no chapter at all"
   apart from the error alone.

   This check does NOT apply to reading or posting in an EXISTING room. If a member
   becomes detached after a conversation already exists, that conversation keeps
   working for both parties — see usp_ChatMessage_GetPrivateHistory / _PostPrivate /
   usp_ChatParticipant_MarkReadPrivate / _SetMute, none of which re-verify chapter
   membership; they authorize on stored MemberAId/MemberBId alone. A brother is never
   silently cut off from an existing conversation because his chapter went dormant.

   Canonical ordering: @A = the smaller of the two ids, @B = the larger.
   CK_ChatRoom_PrivatePair (db/schema/15_chat_private.sql) enforces this same ordering
   at the table level and, as a side effect, forbids a self-conversation for free — but
   this proc still checks @RequestingMemberId <> @OtherMemberId itself (51281) so that
   case gets its own clear message instead of surfacing as a raw CHECK-constraint
   violation.

   Race safety: same pattern as usp_ChatRoom_EnsurePublic. Two members opening a DM
   with each other for the first time at the same instant will both find no existing
   row and both attempt the INSERT; UX_ChatRoom_PrivatePair's unique-key violation is
   caught and treated as "someone else just created it, fetch that row" rather than an
   error. Only the winner writes the AuditLog 'Create' row; the loser returns
   WasCreated = 0.

   Audit: room CREATION is audited (a structural relationship fact, same posture as the
   public room's own create-audit) — NewValues carries MemberAId/MemberBId only, never
   any message content, because there isn't any yet. Per the confirmed decision for
   this module, nothing else about a private room or its messages is ever audited: even
   metadata-only logging of an ordinary send would be a permanent surveillance record
   of private conversation timing/frequency in a table (AuditLog) that is never purged. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatRoom_EnsurePrivate
    @RequestingMemberId INT,
    @OtherMemberId INT,
    @Ip NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @RequestingMemberId = @OtherMemberId
        THROW 51281, 'You cannot start a private conversation with yourself.', 1;

    DECLARE @ReqChapterId INT, @OtherChapterId INT;
    SELECT @ReqChapterId   = ChapterId FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0;
    SELECT @OtherChapterId = ChapterId FROM dbo.Member WHERE MemberId = @OtherMemberId      AND IsDeleted = 0;

    IF @ReqChapterId IS NULL OR @OtherChapterId IS NULL OR @ReqChapterId <> @OtherChapterId
        THROW 51280, 'Not permitted to start a private conversation with this member.', 1;

    DECLARE @A INT = CASE WHEN @RequestingMemberId < @OtherMemberId THEN @RequestingMemberId ELSE @OtherMemberId END;
    DECLARE @B INT = CASE WHEN @RequestingMemberId < @OtherMemberId THEN @OtherMemberId ELSE @RequestingMemberId END;

    DECLARE @RoomId INT, @WasCreated BIT = 0;

    SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE RoomType = 'Private' AND MemberAId = @A AND MemberBId = @B;

    IF @RoomId IS NULL
    BEGIN
        BEGIN TRY
            BEGIN TRAN;
                INSERT dbo.ChatRoom (RoomType, ChapterId, MemberAId, MemberBId, RoomName)
                VALUES ('Private', NULL, @A, @B, NULL);

                SET @RoomId = SCOPE_IDENTITY();
                SET @WasCreated = 1;

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy, IpAddress)
                VALUES ('ChatRoom', CAST(@RoomId AS NVARCHAR(40)), 'Create',
                        CONCAT(N'{"MemberAId":', @A, N',"MemberBId":', @B, N'}'), @RequestingMemberId, @Ip);
            COMMIT;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK;

            /* UX_ChatRoom_PrivatePair fired: a concurrent caller created this pair's
               room in the gap between our SELECT and our INSERT. Success, not an
               error — fetch the row the other caller just created. */
            IF ERROR_NUMBER() IN (2601, 2627)
            BEGIN
                SET @WasCreated = 0;
                SELECT @RoomId = RoomId FROM dbo.ChatRoom WHERE RoomType = 'Private' AND MemberAId = @A AND MemberBId = @B;
            END
            ELSE
                THROW;
        END CATCH
    END

    SELECT  @RoomId AS RoomId,
            @OtherMemberId AS OtherMemberId,
            om.GiftName AS OtherGiftName,
            om.MemberNumber AS OtherMemberNumber,
            om.ChapterId AS OtherChapterId,
            c.ChapterName AS OtherChapterName,
            ms.StatusName AS OtherStatusName,
            ISNULL(cp.IsMuted, CAST(0 AS BIT)) AS IsMuted,
            @WasCreated AS WasCreated
    FROM    dbo.Member om
            JOIN dbo.Chapter c ON c.ChapterId = om.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId = om.StatusId
            LEFT JOIN dbo.ChatParticipant cp ON cp.RoomId = @RoomId AND cp.MemberId = @RequestingMemberId
    WHERE   om.MemberId = @OtherMemberId;
END
GO
