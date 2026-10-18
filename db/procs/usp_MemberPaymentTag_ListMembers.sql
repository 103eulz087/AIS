/* Replaces usp_MemberPaymentTag_GetChapterMembers (2026-10-06, before this module's first
   build+publish — dropped below rather than kept alongside, since nothing external calls
   the old name). Two ways in, same National-only authority:
     - @ChapterId given: every active member of that one chapter (the original screen).
     - @ChapterId NULL, @Search given: a direct, national-wide member search by gift
       name, legal name, or member number — "search a chapter, OR just search a member
       directly" (client decision 2026-10-06) — paged like every other national search in
       this codebase (usp_Member_SearchByJurisdiction's own convention).
   Both may be combined (narrow one chapter's own list by name too). @StatusFilter
   ('Paid'/'Unpaid'/'Free') narrows either mode to just that payment status.

   PaymentStatus is a tri-state now (added 2026-10-06, see 27_member_payment_tag_free_status.sql's
   own header) — 'Paid' (Tagged), 'Free' (given free membership, suppresses the Digital
   ID's "NOT YET PAID" watermark exactly like Paid does), or 'Unpaid' (Untagged, or no
   action row at all — "no row = Unpaid" is this module's own long-standing default). */
IF OBJECT_ID('dbo.usp_MemberPaymentTag_GetChapterMembers') IS NOT NULL
    DROP PROCEDURE dbo.usp_MemberPaymentTag_GetChapterMembers;
GO
CREATE OR ALTER PROCEDURE dbo.usp_MemberPaymentTag_ListMembers
    @RequestingMemberId INT,
    @ChapterId      INT           = NULL,
    @Search         NVARCHAR(100) = NULL,
    @StatusFilter   NVARCHAR(10)  = NULL,  -- 'Paid' | 'Unpaid' | 'Free' | NULL (no filter)
    @MembershipYear INT           = NULL,
    @Skip           INT           = 0,
    @Take           INT           = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF @MembershipYear IS NULL
    BEGIN
        DECLARE @Anniversary DATE = DATEFROMPARTS(YEAR(@Today), 8, 8);
        SET @MembershipYear = CASE WHEN @Today > @Anniversary THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;
    END

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL
      AND  cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51910, 'The National Council is not configured.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51911, 'Only the National Council Admin may view member payment status.', 1;

    IF @ChapterId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId)
        THROW 51912, 'Chapter not found.', 1;

    SET @Search = NULLIF(LTRIM(RTRIM(@Search)), N'');
    IF @ChapterId IS NULL AND @Search IS NULL
        THROW 51914, 'Search for a chapter or a member first.', 1;
    IF @ChapterId IS NULL AND LEN(@Search) < 2
        THROW 51916, 'Enter at least 2 characters to search for a member.', 1;

    -- Wildcards in what the officer typed are matched literally, never as patterns —
    -- same escaping convention as usp_ChapterRegistration_GetQueue's own @Search.
    DECLARE @Pattern NVARCHAR(320) = CASE WHEN @Search IS NULL THEN NULL ELSE
        N'%' + REPLACE(REPLACE(REPLACE(REPLACE(@Search, N'\', N'\\'), N'%', N'\%'), N'_', N'\_'), N'[', N'\[') + N'%' END;

    IF @StatusFilter IS NOT NULL AND @StatusFilter NOT IN ('Paid', 'Unpaid', 'Free')
        THROW 51915, 'Status must be Paid, Unpaid, or Free.', 1;

    ;WITH LatestAction AS (
        SELECT  MemberId, ActionType, PerformedDate, PerformedBy,
                ROW_NUMBER() OVER (PARTITION BY MemberId ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC) AS rn
        FROM    dbo.MemberPaymentTagAction
        WHERE   MembershipYear = @MembershipYear
    ),
    Matches AS (
        SELECT  m.MemberId, m.MemberNumber, m.GiftName,
                m.FirstName, m.MiddleName, m.LastName, m.MobileNo,
                m.ChapterId, ch.ChapterName,
                ms.StatusName,
                CASE la.ActionType WHEN 'Tagged' THEN 'Paid' WHEN 'Free' THEN 'Free' ELSE 'Unpaid' END AS PaymentStatus,
                la.PerformedDate AS TaggedDate,
                tb.GiftName AS TaggedByGiftName
        FROM    dbo.Member m
                JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
                JOIN dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
                LEFT JOIN LatestAction la ON la.MemberId = m.MemberId AND la.rn = 1
                LEFT JOIN dbo.Member tb   ON tb.MemberId = la.PerformedBy
        WHERE   m.IsDeleted = 0
          AND   (@ChapterId IS NULL OR m.ChapterId = @ChapterId)
          AND   (@Pattern IS NULL
                 OR m.GiftName                                    LIKE @Pattern ESCAPE N'\'
                 OR m.MemberNumber                                LIKE @Pattern ESCAPE N'\'
                 OR m.FirstName                                   LIKE @Pattern ESCAPE N'\'
                 OR m.LastName                                    LIKE @Pattern ESCAPE N'\'
                 OR CONCAT(m.FirstName, N' ', m.LastName)         LIKE @Pattern ESCAPE N'\')
    )
    SELECT  MemberId, MemberNumber, GiftName, FirstName, MiddleName, LastName, MobileNo,
            ChapterId, ChapterName, StatusName, PaymentStatus, TaggedDate, TaggedByGiftName,
            @MembershipYear AS MembershipYear,
            COUNT(*) OVER() AS TotalCount
    FROM    Matches
    WHERE   @StatusFilter IS NULL OR PaymentStatus = @StatusFilter
    ORDER BY GiftName
    OFFSET (CASE WHEN @ChapterId IS NOT NULL THEN 0 ELSE @Skip END) ROWS
    FETCH NEXT (CASE WHEN @ChapterId IS NOT NULL THEN 2147483647 ELSE @Take END) ROWS ONLY;
END
GO
