/* Files a new corrective action (a disciplinary case) against a member of the caller's
   OWN chapter. ChapterAdmin only (docs §3.1, CLAUDE.md — filing is a chapter-officer-
   restricted act, narrower than the read side which any chapter officer or the subject
   himself may see — see ScopeGuard.CanSeeCaseNarrative's header comment for the read
   asymmetry this proc's write side deliberately does NOT share).

   A chapter can only discipline its own member — @SubjectMemberId must be an undeleted
   member of @ChapterId, checked here rather than trusted from the caller (CLAUDE.md
   invariant #4 — every write is scoped, never assume the caller's own client-side
   dropdown already filtered this).

   One transaction: insert the case (FiledBy = @RequestingMemberId, Content is the
   narrative — written ONCE, here, and never touched again by any other procedure in
   this module — see usp_CorrectiveAction_AddUpdate's header comment), insert the
   OPENING CorrectiveActionUpdate row so the status-history timeline always starts with
   an entry (never a case with a status but no history row explaining how it got there),
   audit, or none of it. Returns the new CaseId. */
CREATE OR ALTER PROCEDURE dbo.usp_CorrectiveAction_File
    @ChapterId INT,
    @RequestingMemberId INT,
    @SubjectMemberId INT,
    @CategoryId INT,
    @DateFiled DATE,
    @Content NVARCHAR(MAX),
    @InitialStatusName NVARCHAR(20) = 'Pending'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

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
          AND r.RoleName   = 'ChapterAdmin'
    )
        THROW 51249, 'Only the chapter admin may file a corrective action.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.Member
        WHERE MemberId = @SubjectMemberId AND ChapterId = @ChapterId AND IsDeleted = 0
    )
        THROW 51250, 'That member does not belong to this chapter. A chapter may only file a corrective action against its own member.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.CorrectiveActionCategory WHERE CategoryId = @CategoryId)
        THROW 51251, 'Unrecognised corrective action category.', 1;

    IF @InitialStatusName NOT IN ('Pending', 'Under Review', 'Reconciled', 'Dismissed')
        THROW 51252, 'Unrecognised status. Use Pending, Under Review, Reconciled or Dismissed.', 1;

    IF @Content IS NULL OR LEN(LTRIM(RTRIM(@Content))) = 0
        THROW 51252, 'A corrective action must have a narrative.', 1;

    DECLARE @CaseId INT;
    DECLARE @IsResolving BIT = CASE WHEN @InitialStatusName IN ('Reconciled', 'Dismissed') THEN 1 ELSE 0 END;

    BEGIN TRAN;
        INSERT dbo.CorrectiveAction (
            ChapterId, MemberId, CategoryId, DateFiled, FiledBy, Content, StatusName,
            ResolutionNotes, ResolutionDate)
        VALUES (
            @ChapterId, @SubjectMemberId, @CategoryId, @DateFiled, @RequestingMemberId, @Content, @InitialStatusName,
            NULL, CASE WHEN @IsResolving = 1 THEN @Today END);

        SET @CaseId = SCOPE_IDENTITY();

        /* Opening history row — every case's timeline starts here, never blank. */
        INSERT dbo.CorrectiveActionUpdate (CaseId, UpdatedBy, StatusName, Notes)
        VALUES (@CaseId, @RequestingMemberId, @InitialStatusName, N'Case filed.');

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('CorrectiveAction', CAST(@CaseId AS NVARCHAR(40)), 'File',
                CONCAT(N'{"MemberId":', @SubjectMemberId, N',"CategoryId":', @CategoryId,
                       N',"StatusName":"', @InitialStatusName, N'"}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @CaseId AS CaseId;
END
GO
