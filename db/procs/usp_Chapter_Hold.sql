/* Places a chapter on hold — every member of it is immediately unable to sign in
   (usp_Auth_GetAccountForSignIn's own IsChapterOnHold check), every live session is
   cut (usp_RefreshToken_RevokeFamily per member, same immediate-cutoff mechanics
   usp_Member_Block already uses for one member), and every pending enrolment link is
   invalidated so nobody can sidestep the hold by finishing a first-time signup. See
   23_chapter_hold.sql's own header for the authority decision behind this.

   TWO eligible actors, unconditionally OR'd — never a second mechanism layered on top
   of usp_Approval_ResolveApprover, the same "nearest ancestor with seated officers"
   routing this codebase already uses everywhere else:

   1. NATIONAL COUNCIL, always — a CouncilAdmin seated at the root council
      (ParentCouncilId IS NULL). Org-wide oversight, matches usp_Member_Block's own
      National-only check exactly.

   2. THE CHAPTER'S OWN RESOLVED GOVERNING COUNCIL — whichever council
      usp_Approval_ResolveApprover finds by walking up from this chapter's own
      ParentCouncilId (its immediate council if seated, otherwise the nearest seated
      ancestor — dormancy is handled by that same walk, not a special case here). A
      CouncilAdmin seated there may act directly on chapters in that jurisdiction
      without escalating to National every time. */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_Hold
    @RequestingMemberId INT,
    @ChapterId          INT,
    @Reason              NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51750, 'A reason is required.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId)
        THROW 51751, 'Chapter not found.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);
    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);

    -- Swallowed into a throwaway table variable, never returned — a bare EXEC here
    -- would otherwise bubble its own SELECT up as an extra result set ahead of this
    -- proc's own (same workaround usp_Chapter_SeatOfficer already uses around this
    -- exact call).
    DECLARE @Suppress TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
    INSERT INTO @Suppress
    EXEC dbo.usp_Approval_ResolveApprover
        @ParentCouncilId = @ParentCouncilId,
        @ActingCouncilIdOut = @ActingCouncilId OUTPUT, @RoutingReasonOut = @RoutingReason OUTPUT;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
               JOIN dbo.Council c ON c.CouncilId = mr.ScopeId AND mr.ScopeType = 'Council'
        WHERE  mr.MemberId = @RequestingMemberId AND r.RoleName = 'CouncilAdmin'
          AND  c.ParentCouncilId IS NULL
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        UNION ALL
        SELECT 1 FROM dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND  r.RoleName = 'CouncilAdmin'
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51752, 'Only National Council, or this chapter''s own governing council, may place a chapter on hold.', 1;

    IF EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId AND IsOnHold = 1)
        THROW 51753, 'This chapter is already on hold.', 1;

    BEGIN TRAN;
        UPDATE dbo.Chapter SET IsOnHold = 1 WHERE ChapterId = @ChapterId;

        -- Cut every already-signed-in session for this chapter's members right now —
        -- do not wait for IsOnHold to be noticed at the next natural sign-in. No
        -- result set from usp_RefreshToken_RevokeFamily (verified — it's a bare
        -- UPDATE/INSERT), so calling it in a loop is safe here.
        DECLARE @AccountId INT;
        DECLARE HoldCursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT ua.AccountId
            FROM   dbo.UserAccount ua JOIN dbo.Member m ON m.MemberId = ua.MemberId
            WHERE  m.ChapterId = @ChapterId AND m.IsDeleted = 0;
        OPEN HoldCursor;
        FETCH NEXT FROM HoldCursor INTO @AccountId;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC dbo.usp_RefreshToken_RevokeFamily @AccountId = @AccountId, @Reason = N'Chapter placed on hold';
            FETCH NEXT FROM HoldCursor INTO @AccountId;
        END
        CLOSE HoldCursor;
        DEALLOCATE HoldCursor;

        -- A not-yet-enrolled member cannot sidestep the hold by finishing a pending
        -- first-time signup — same reasoning as usp_Member_Block's own link invalidation.
        UPDATE el
           SET InvalidatedOn = SYSUTCDATETIME(), InvalidatedReason = N'Chapter placed on hold'
        FROM   dbo.EnrolmentLink el
               JOIN dbo.Member m ON m.MemberId = el.MemberId
        WHERE  m.ChapterId = @ChapterId AND el.RedeemedOn IS NULL AND el.InvalidatedOn IS NULL;

        INSERT dbo.ChapterHoldAction (ChapterId, ActionType, Reason, PerformedBy)
        VALUES (@ChapterId, 'Held', @Reason, @RequestingMemberId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Chapter', CAST(@ChapterId AS NVARCHAR(40)), 'Hold',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;
END
GO
