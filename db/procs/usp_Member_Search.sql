/* Directory search.
   Cross-chapter results are restricted to gift name, chapter and status — client decision.
   The restricted columns are returned as NULL so the API maps them to a narrower DTO.

   @StatusId (optional) filters to one exact dbo.MemberStatus — added so a dashboard
   tile like "Inactive: 7" can link to a real filtered list instead of a dead-end
   number. NULL/omitted leaves every existing caller's behavior unchanged. Note this
   only ADDS to the @IncludeInactive gate above, it does not replace it — a caller
   drilling into a non-Approved/Active status (e.g. Suspended, Pending, Rejected)
   must still pass @IncludeInactive = 1 alongside @StatusId, same as today. */
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

    DECLARE @CallerChapterId INT, @SameChapter BIT = 0;
    SELECT @CallerChapterId = ChapterId FROM dbo.Member WHERE MemberId = @RequestingMemberId;
    IF @CallerChapterId IS NULL THROW 51010, 'Unknown requesting member.', 1;

    IF @ChapterId IS NULL SET @ChapterId = @CallerChapterId;
    IF @ChapterId = @CallerChapterId SET @SameChapter = 1;

    SELECT  m.MemberId, m.GiftName, m.MemberNumber, m.ChapterId, ch.ChapterName,
            ms.StatusName, m.RenewedThrough,
            CASE WHEN @SameChapter = 1 THEN m.FirstName  END AS FirstName,
            CASE WHEN @SameChapter = 1 THEN m.MiddleName END AS MiddleName,
            CASE WHEN @SameChapter = 1 THEN m.LastName   END AS LastName,
            CASE WHEN @SameChapter = 1 THEN m.MobileNo   END AS MobileNo,
            CASE WHEN @SameChapter = 1 THEN m.Profession END AS Profession,
            CASE WHEN @SameChapter = 1 THEN bt.BloodTypeName END AS BloodType,
            CASE WHEN @SameChapter = 1 THEN m.PhotoPath  END AS PhotoPath,
            @SameChapter AS IsSameChapter,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Member m
            JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
            LEFT JOIN dbo.BloodType bt ON bt.BloodTypeId = m.BloodTypeId
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
