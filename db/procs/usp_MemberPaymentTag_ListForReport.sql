/* The members behind a Payment report number (2026-10-19). Clicking Total / Paid / Free /
   Unpaid on the report — or a chapter's row — lists the members it counted, with the date
   each was tagged Paid or Free and by whom, for exactly the chapters the report is showing.

   Gate: MemberPaymentTag.Read ("View payment tags") on a National seat — the same key as
   the member-by-member Payment tags screen. The report itself (counts only) is
   MemberPaymentTag.Report; names stay behind Read, so an office given only the report
   never sees who is behind the counts (db/schema/32_payment_report_permission.sql).

   @ChapterIds: comma-separated chapter ids — the chapters the report currently shows
   after its search and place filters. NULL = every chapter. @StatusFilter: Paid, Free,
   Unpaid or NULL (all). @Search narrows by gift name, member number or legal name.
   Counted exactly like usp_MemberPaymentTag_GetReport (chapter-homed, non-deleted; the
   latest tag action for the year decides; none = Unpaid), so the list always adds up to
   the number that was clicked. TaggedDate is when National recorded the tag — the date a
   member was marked Paid (or Free), never an amount (invariant #5). No contact details. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberPaymentTag_ListForReport
    @RequestingMemberId INT,
    @MembershipYear     INT           = NULL,
    @ChapterIds         NVARCHAR(MAX) = NULL,
    @StatusFilter       NVARCHAR(10)  = NULL,
    @Search             NVARCHAR(100) = NULL,
    @Skip               INT           = 0,
    @Take               INT           = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF @MembershipYear IS NULL
        SET @MembershipYear = CASE WHEN @Today > DATEFROMPARTS(YEAR(@Today), 8, 8)
                                   THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL AND cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51910, 'The National Council is not configured.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.fn_MemberSeatPermissions(@RequestingMemberId) sp
        WHERE  sp.CouncilId = @NationalCouncilId AND sp.PermissionKey = N'MemberPaymentTag.Read'
    )
        THROW 51911, 'Seeing the members behind these numbers needs the "View payment tags" permission. Ask the National President to switch it on for your office.', 1;

    IF @StatusFilter IS NOT NULL AND @StatusFilter NOT IN (N'Paid', N'Unpaid', N'Free')
        THROW 51915, 'Status must be Paid, Unpaid, or Free.', 1;

    SET @Search = NULLIF(LTRIM(RTRIM(@Search)), N'');
    SET @Skip = CASE WHEN @Skip IS NULL OR @Skip < 0 THEN 0 ELSE @Skip END;
    SET @Take = CASE WHEN @Take IS NULL OR @Take < 1 THEN 50 WHEN @Take > 500 THEN 500 ELSE @Take END;

    DECLARE @Pattern NVARCHAR(320) = CASE WHEN @Search IS NULL THEN NULL ELSE
        N'%' + REPLACE(REPLACE(REPLACE(REPLACE(@Search, N'\', N'\\'), N'%', N'\%'), N'_', N'\_'), N'[', N'\[') + N'%' END;

    DECLARE @Chapters TABLE (ChapterId INT PRIMARY KEY);
    IF @ChapterIds IS NOT NULL
        INSERT INTO @Chapters (ChapterId)
        SELECT DISTINCT TRY_CAST(LTRIM(RTRIM(value)) AS INT)
        FROM   STRING_SPLIT(@ChapterIds, N',')
        WHERE  TRY_CAST(LTRIM(RTRIM(value)) AS INT) IS NOT NULL;

    WITH LatestAction AS (
        SELECT  MemberId, ActionType, PerformedDate, PerformedBy,
                ROW_NUMBER() OVER (PARTITION BY MemberId ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC) AS rn
        FROM    dbo.MemberPaymentTagAction
        WHERE   MembershipYear = @MembershipYear
    ),
    ChapterCouncils AS (
        SELECT ch.ChapterId, c.ParentCouncilId, c.CouncilName, cl.LevelName
        FROM   dbo.Chapter ch
               JOIN dbo.Council c       ON c.CouncilId = ch.ParentCouncilId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE  @ChapterIds IS NULL OR ch.ChapterId IN (SELECT ChapterId FROM @Chapters)
        UNION ALL
        SELECT cc.ChapterId, p.ParentCouncilId, p.CouncilName, cl.LevelName
        FROM   ChapterCouncils cc
               JOIN dbo.Council p       ON p.CouncilId = cc.ParentCouncilId
               JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = p.CouncilLevelId
    ),
    Places AS (
        SELECT  ChapterId,
                MAX(CASE WHEN LevelName = 'Regional'       THEN CouncilName END) AS RegionName,
                MAX(CASE WHEN LevelName = 'Provincial'     THEN CouncilName END) AS ProvinceName,
                MAX(CASE WHEN LevelName = 'City/Municipal' THEN CouncilName END) AS CityName
        FROM    ChapterCouncils
        GROUP BY ChapterId
    ),
    Matches AS (
        SELECT  m.MemberId, m.MemberNumber, m.GiftName,
                LTRIM(RTRIM(CONCAT(m.FirstName, N' ', m.LastName))) AS FullName,
                m.ChapterId, ch.ChapterName, pl.RegionName, pl.ProvinceName, pl.CityName,
                CASE la.ActionType WHEN 'Tagged' THEN N'Paid' WHEN 'Free' THEN N'Free' ELSE N'Unpaid' END AS PaymentStatus,
                CASE WHEN la.ActionType IN ('Tagged', 'Free') THEN la.PerformedDate END AS TaggedDate,
                CASE WHEN la.ActionType IN ('Tagged', 'Free') THEN tb.GiftName END AS TaggedByGiftName
        FROM    dbo.Member m
                JOIN dbo.Chapter ch       ON ch.ChapterId = m.ChapterId
                LEFT JOIN Places pl       ON pl.ChapterId = m.ChapterId
                LEFT JOIN LatestAction la ON la.MemberId = m.MemberId AND la.rn = 1
                LEFT JOIN dbo.Member tb   ON tb.MemberId = la.PerformedBy
        WHERE   m.IsDeleted = 0
          AND   (@ChapterIds IS NULL OR m.ChapterId IN (SELECT ChapterId FROM @Chapters))
          AND   (@Pattern IS NULL
                 OR m.GiftName                            LIKE @Pattern ESCAPE N'\'
                 OR m.MemberNumber                        LIKE @Pattern ESCAPE N'\'
                 OR m.FirstName                           LIKE @Pattern ESCAPE N'\'
                 OR m.LastName                            LIKE @Pattern ESCAPE N'\'
                 OR CONCAT(m.FirstName, N' ', m.LastName) LIKE @Pattern ESCAPE N'\')
    )
    SELECT  MemberId, MemberNumber, GiftName, FullName,
            ChapterId, ChapterName, RegionName, ProvinceName, CityName,
            PaymentStatus, TaggedDate, TaggedByGiftName,
            @MembershipYear AS MembershipYear,
            COUNT(*) OVER() AS TotalCount
    FROM    Matches
    WHERE   @StatusFilter IS NULL OR PaymentStatus = @StatusFilter
    -- Paid/Free: most recently tagged first (answers "who paid lately?"); otherwise by chapter.
    ORDER BY CASE WHEN TaggedDate IS NULL THEN 1 ELSE 0 END,
             TaggedDate DESC, ChapterName, GiftName, MemberId
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY
    OPTION (MAXRECURSION 20);
END
GO
