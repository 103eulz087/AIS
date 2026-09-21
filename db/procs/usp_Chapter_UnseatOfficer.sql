/* Unseats a chapter officer — sets TermEnd, never deletes (invariant #15's logic
   extended to MemberRole, same as usp_Council_UnseatOfficer). Same authority split as
   usp_Chapter_SeatOfficer: unseating the President needs the council above; unseating
   any other office needs only the chapter's own seated President. The plain "Member"
   MemberRole row (OfficeId IS NULL) is never touched here — outgoing officers keep
   their member record and their history; only the office ends (§7A.4). */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_UnseatOfficer
    @RequestingMemberId INT,
    @MemberRoleId INT,
    @Reason       NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51710, 'A reason is required.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ChapterId INT, @OfficeId INT;
    SELECT @ChapterId = ScopeId, @OfficeId = OfficeId
    FROM   dbo.MemberRole
    WHERE  MemberRoleId = @MemberRoleId AND ScopeType = 'Chapter' AND OfficeId IS NOT NULL
      AND  (TermEnd IS NULL OR TermEnd >= @Today);

    IF @ChapterId IS NULL
        THROW 51711, 'This seat was not found, or has already ended.', 1;

    DECLARE @PresidentOfficeId INT = (SELECT OfficeId FROM dbo.ChapterOffice WHERE OfficeName = 'President');

    IF @OfficeId = @PresidentOfficeId
    BEGIN
        DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);
        DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
        DECLARE @Suppress TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
        INSERT INTO @Suppress
        EXEC dbo.usp_Approval_ResolveApprover
            @ParentCouncilId = @ParentCouncilId,
            @ActingCouncilIdOut = @ActingCouncilId OUTPUT, @RoutingReasonOut = @RoutingReason OUTPUT;

        IF NOT EXISTS (
            SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
            WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
              AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        )
            THROW 51712, 'Only the council above this chapter may unseat its President.', 1;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
            WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Chapter' AND mr.ScopeId = @ChapterId
              AND r.RoleName = 'ChapterAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        )
            THROW 51713, 'Only this chapter''s own President may unseat this officer.', 1;
    END

    BEGIN TRAN;
        UPDATE dbo.MemberRole SET TermEnd = @Today WHERE MemberRoleId = @MemberRoleId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MemberRole', CAST(@MemberRoleId AS NVARCHAR(40)), 'ChapterUnseat',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;
END
GO
