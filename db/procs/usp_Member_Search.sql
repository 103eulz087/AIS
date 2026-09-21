/* Directory search.
   Cross-chapter results are restricted to gift name, chapter and status — client decision.
   The restricted columns are returned as NULL so the API maps them to a narrower DTO.

   @StatusId (optional) filters to one exact dbo.MemberStatus — added so a dashboard
   tile like "Inactive: 7" can link to a real filtered list instead of a dead-end
   number. NULL/omitted leaves every existing caller's behavior unchanged. Note this
   only ADDS to the @IncludeInactive gate above, it does not replace it — a caller
   drilling into a non-Approved/Active status (e.g. Suspended, Pending, Rejected)
   must still pass @IncludeInactive = 1 alongside @StatusId, same as today.

   OfficeName/IsBlocked/RowVersion (client decision 2026-09-22): same-chapter-only, same
   restraint as every other column here — a currently-held chapter office and a blocked
   login are not cross-chapter-visible facts either. RowVersion rides along so the
   directory's own edit action (usp_Member_UpdateByOfficer) needs no separate round trip
   to fetch a concurrency token before opening its form. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_Search
    @RequestingMemberId INT,
    @ChapterId   INT           = NULL,
    @Search      NVARCHAR(100) = NULL,
    @BloodTypeId INT           = NULL,
    @SkillId     INT           = NULL,
    @IncludeInactive BIT       = 0,
    @StatusId   INT            = NULL,   -- optional: filter to one MemberStatus (dashboard drill-down)
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CallerChapterId INT, @SameChapter BIT = 0, @CallerExists BIT = 0;
    SELECT @CallerChapterId = ChapterId, @CallerExists = 1
    FROM dbo.Member WHERE MemberId = @RequestingMemberId;

    -- Only a genuinely unknown/nonexistent @RequestingMemberId (no Member row at all) is an
    -- error. A detached member (CLAUDE.md invariant #14 — HomeCouncilId set, ChapterId NULL,
    -- e.g. a council officer whose own chapter went dormant) is a real, expected caller: he
    -- simply has no chapter of his own, so he can never be "same chapter" as anything, and if
    -- he supplies no @ChapterId at all there is no home chapter to default to.
    IF @CallerExists = 0 THROW 51010, 'Unknown requesting member.', 1;

    IF @ChapterId IS NULL SET @ChapterId = @CallerChapterId;
    IF @CallerChapterId IS NOT NULL AND @ChapterId = @CallerChapterId SET @SameChapter = 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    SELECT  m.MemberId, m.GiftName, m.MemberNumber, m.ChapterId, ch.ChapterName,
            ms.StatusName, m.RenewedThrough,
            CASE WHEN @SameChapter = 1 THEN m.FirstName  END AS FirstName,
            CASE WHEN @SameChapter = 1 THEN m.MiddleName END AS MiddleName,
            CASE WHEN @SameChapter = 1 THEN m.LastName   END AS LastName,
            CASE WHEN @SameChapter = 1 THEN m.MobileNo   END AS MobileNo,
            CASE WHEN @SameChapter = 1 THEN m.Profession END AS Profession,
            CASE WHEN @SameChapter = 1 THEN bt.BloodTypeName END AS BloodType,
            CASE WHEN @SameChapter = 1 THEN m.PhotoPath  END AS PhotoPath,
            CASE WHEN @SameChapter = 1 THEN co.OfficeName END AS OfficeName,
            CASE WHEN @SameChapter = 1
                 THEN CAST(CASE WHEN ua.IsDisabled = 1 THEN 1 ELSE 0 END AS BIT) END AS IsBlocked,
            CASE WHEN @SameChapter = 1 THEN m.RowVersion END AS RowVersion,
            @SameChapter AS IsSameChapter,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Member m
            JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
            LEFT JOIN dbo.BloodType bt ON bt.BloodTypeId = m.BloodTypeId
            LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
            -- The one CURRENT chapter office this member holds, if any. SortOrder as the
            -- tiebreaker is academic today (at most one live holder per office/chapter,
            -- UX_MemberRole_ChapterOffice_Live-style — see usp_Chapter_SeatOfficer's own
            -- "already held" check), kept only so a future multi-office member reads
            -- deterministically as his most senior office.
            OUTER APPLY (
                SELECT TOP (1) co2.OfficeName
                FROM   dbo.MemberRole mr
                       JOIN dbo.ChapterOffice co2 ON co2.OfficeId = mr.OfficeId
                WHERE  mr.MemberId = m.MemberId AND mr.ScopeType = 'Chapter' AND mr.ScopeId = m.ChapterId
                  AND  mr.OfficeId IS NOT NULL
                  AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                ORDER BY co2.SortOrder
            ) co
    WHERE   m.ChapterId = @ChapterId
      AND   m.IsDeleted = 0
      AND   (@IncludeInactive = 1 OR ms.StatusName IN ('Approved','Active'))
      AND   (@StatusId IS NULL OR m.StatusId = @StatusId)
      AND   (@Search IS NULL OR m.GiftName LIKE '%' + @Search + '%'
                             OR m.LastName LIKE '%' + @Search + '%'
                             OR m.MemberNumber LIKE '%' + @Search + '%')
      -- blood type and skill filters only apply within your own chapter
      AND   (@BloodTypeId IS NULL OR (@SameChapter = 1 AND m.BloodTypeId = @BloodTypeId))
      AND   (@SkillId IS NULL OR (@SameChapter = 1 AND EXISTS (
                SELECT 1 FROM dbo.MemberSkill sk
                WHERE sk.MemberId = m.MemberId AND sk.SkillId = @SkillId)))
    ORDER BY m.GiftName
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
