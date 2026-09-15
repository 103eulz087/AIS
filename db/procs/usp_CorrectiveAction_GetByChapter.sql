/* Paged corrective-action list for a chapter. ANY member of the chapter may call this
   (reading the SUMMARY shape — name, category, status, date — is for everyone, docs
   §4.5 "Option B"; filing and status changes are the ChapterAdmin-only acts, not this).

   The narrative fields (Content, ResolutionNotes, FiledBy) are NULLed OUT IN SQL, per
   row, for a caller who may not see them — matching usp_Member_Search's exact
   CASE WHEN ... THEN x END pattern (CLAUDE.md invariant #6: the C#-side
   ScopeGuard.CanSeeCaseNarrative check is defence in depth, not the only defence; the
   database must not hand the narrative to a caller who cannot see it, even if every
   C# layer above it were somehow bypassed).

   CanSeeNarrative mirrors ScopeGuard.CanSeeCaseNarrative EXACTLY: the caller is in the
   SAME chapter (always true here — the WHERE clause already scopes to @ChapterId) AND
   (the caller holds an active ChapterOfficer/ChapterTreasurer/ChapterAdmin role at this
   chapter OR the caller IS the subject of that particular case). Returned as its own
   bit column so the API knows which DTO shape to build per row.

   No status-history timeline here — that lives in usp_CorrectiveAction_Get, one case
   at a time. This proc is the list; COUNT(*) OVER() for paging, newest-DateFiled-first. */
CREATE OR ALTER PROCEDURE dbo.usp_CorrectiveAction_GetByChapter
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51256, 'Not permitted to read this chapter''s corrective actions.', 1;

    DECLARE @CallerIsOfficer BIT = CASE WHEN EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName IN ('ChapterOfficer', 'ChapterTreasurer', 'ChapterAdmin')
    ) THEN 1 ELSE 0 END;

    SELECT  ca.CaseId, ca.ChapterId,
            ca.MemberId, m.GiftName, m.MemberNumber,
            ca.CategoryId, cat.CategoryName,
            ca.StatusName, ca.DateFiled, ca.ResolutionDate,
            CAST(CASE WHEN @CallerIsOfficer = 1 OR ca.MemberId = @RequestingMemberId THEN 1 ELSE 0 END AS BIT) AS CanSeeNarrative,
            CASE WHEN @CallerIsOfficer = 1 OR ca.MemberId = @RequestingMemberId THEN ca.Content         END AS Content,
            CASE WHEN @CallerIsOfficer = 1 OR ca.MemberId = @RequestingMemberId THEN ca.ResolutionNotes END AS ResolutionNotes,
            CASE WHEN @CallerIsOfficer = 1 OR ca.MemberId = @RequestingMemberId THEN ca.FiledBy         END AS FiledBy,
            CASE WHEN @CallerIsOfficer = 1 OR ca.MemberId = @RequestingMemberId THEN fb.GiftName        END AS FiledByGiftName,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.CorrectiveAction ca
            JOIN dbo.Member m   ON m.MemberId  = ca.MemberId
            JOIN dbo.CorrectiveActionCategory cat ON cat.CategoryId = ca.CategoryId
            LEFT JOIN dbo.Member fb ON fb.MemberId = ca.FiledBy
    WHERE   ca.ChapterId = @ChapterId
    ORDER BY ca.DateFiled DESC, ca.CaseId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
