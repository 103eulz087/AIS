/* A chapter admin's own review queue. Re-checks the caller holds an active ChapterAdmin
   role at @ChapterId — never trust that a caller who reached this endpoint was already
   scope-checked upstream (CLAUDE.md invariant #4). Mirrors the exact role-check block
   used throughout this codebase (usp_Meeting_Create et al.), narrowed to ChapterAdmin
   only: reviewing sign-ups is a Chapter Admin action, not a general officer one. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_GetQueue
    @ChapterId INT,
    @RequestingMemberId INT,
    @StatusId  INT = NULL,
    @Skip INT = 0,
    @Take INT = 50
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
          AND r.RoleName = 'ChapterAdmin'
    )
        THROW 51221, 'Only the chapter admin may view this chapter''s membership applications.', 1;

    SELECT  a.ApplicationId, a.ReferenceNo, a.FirstName, a.MiddleName, a.LastName, a.GiftName,
            a.MobileNo, a.Email, a.StatusId, s.StatusName, a.SubmittedDate,
            a.DecidedBy, a.DecidedDate,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.MembershipApplication a
            JOIN dbo.MembershipApplicationStatus s ON s.StatusId = a.StatusId
    WHERE   a.ChapterId = @ChapterId
      AND   (@StatusId IS NULL OR a.StatusId = @StatusId)
    ORDER BY a.SubmittedDate DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
