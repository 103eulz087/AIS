/* Reverses usp_Chapter_Hold — same two-actor authority check (National, or this
   chapter's own resolved governing council). Restores sign-in only; there is nothing
   to reissue — a member simply signs in again (or, if he never had an account, asks
   his chapter for a fresh enrolment link, same as any other invalidated one). */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_Release
    @RequestingMemberId INT,
    @ChapterId          INT,
    @Reason              NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51754, 'A reason is required.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId)
        THROW 51755, 'Chapter not found.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);
    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);

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
        THROW 51756, 'Only National Council, or this chapter''s own governing council, may release a chapter from hold.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId AND IsOnHold = 1)
        THROW 51757, 'This chapter is not currently on hold.', 1;

    BEGIN TRAN;
        UPDATE dbo.Chapter SET IsOnHold = 0 WHERE ChapterId = @ChapterId;

        INSERT dbo.ChapterHoldAction (ChapterId, ActionType, Reason, PerformedBy)
        VALUES (@ChapterId, 'Released', @Reason, @RequestingMemberId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Chapter', CAST(@ChapterId AS NVARCHAR(40)), 'Release',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;
END
GO
