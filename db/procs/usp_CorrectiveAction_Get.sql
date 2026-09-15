/* One corrective action, in full — same anti-enumeration posture as usp_Meeting_Get /
   usp_Donation_Get / usp_Expense_Get: a case belonging to a different chapter and a
   nonexistent CaseId return the IDENTICAL "not found" message, so this endpoint cannot
   be used to probe which case ids exist in someone else's chapter.

   CanSeeNarrative mirrors ScopeGuard.CanSeeCaseNarrative exactly (same predicate as
   usp_CorrectiveAction_GetByChapter — see that proc's header comment) and gates the
   narrative fields IN SQL, per CLAUDE.md invariant #6.

   Two result sets:
     1. The case header, Content/ResolutionNotes/FiledBy NULLed out for a caller who
        may not see them, CanSeeNarrative returned as its own bit column.
     2. The FULL status-history timeline — every member of the chapter sees the
        TIMELINE of status changes (that is public, per docs §4.5's four-field rule:
        status and date are always visible), just not WHO changed it or WHY when he
        cannot see the narrative. UpdatedBy/Notes are NULLed per row for a caller with
        CanSeeNarrative = 0; StatusName/UpdateDate are never withheld. */
CREATE OR ALTER PROCEDURE dbo.usp_CorrectiveAction_Get
    @CaseId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @ChapterId INT, @SubjectMemberId INT;
    SELECT @ChapterId = ChapterId, @SubjectMemberId = MemberId
    FROM   dbo.CorrectiveAction
    WHERE  CaseId = @CaseId;

    IF @ChapterId IS NULL
        THROW 51257, 'Corrective action not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51257, 'Corrective action not found.', 1;

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

    DECLARE @CanSeeNarrative BIT = CASE
        WHEN @CallerIsOfficer = 1 OR @SubjectMemberId = @RequestingMemberId THEN 1
        ELSE 0
    END;

    -- 1. Header
    SELECT  ca.CaseId, ca.ChapterId,
            ca.MemberId, m.GiftName, m.MemberNumber,
            ca.CategoryId, cat.CategoryName,
            ca.StatusName, ca.DateFiled, ca.ResolutionDate,
            @CanSeeNarrative AS CanSeeNarrative,
            CASE WHEN @CanSeeNarrative = 1 THEN ca.Content         END AS Content,
            CASE WHEN @CanSeeNarrative = 1 THEN ca.ResolutionNotes END AS ResolutionNotes,
            CASE WHEN @CanSeeNarrative = 1 THEN ca.FiledBy         END AS FiledBy,
            CASE WHEN @CanSeeNarrative = 1 THEN fb.GiftName        END AS FiledByGiftName
    FROM    dbo.CorrectiveAction ca
            JOIN dbo.Member m   ON m.MemberId  = ca.MemberId
            JOIN dbo.CorrectiveActionCategory cat ON cat.CategoryId = ca.CategoryId
            LEFT JOIN dbo.Member fb ON fb.MemberId = ca.FiledBy
    WHERE   ca.CaseId = @CaseId;

    -- 2. Status-history timeline — StatusName/UpdateDate always visible; UpdatedBy/Notes
    --    gated the same way as the header's narrative fields.
    SELECT  u.UpdateId, u.UpdateDate, u.StatusName,
            CASE WHEN @CanSeeNarrative = 1 THEN u.UpdatedBy  END AS UpdatedBy,
            CASE WHEN @CanSeeNarrative = 1 THEN ub.GiftName  END AS UpdatedByGiftName,
            CASE WHEN @CanSeeNarrative = 1 THEN u.Notes      END AS Notes
    FROM    dbo.CorrectiveActionUpdate u
            LEFT JOIN dbo.Member ub ON ub.MemberId = u.UpdatedBy
    WHERE   u.CaseId = @CaseId
    ORDER BY u.UpdateDate ASC, u.UpdateId ASC;
END
GO
