/* National Digital ID image export — bulk read for the SkiaSharp-rendered front/back PNG
   export (client decision 2026-10-06, a second export type alongside the existing
   Magicard spreadsheet+photos export). Same CALLER MUST BE SEATED CouncilAdmin ON THE
   NATIONAL COUNCIL SPECIFICALLY check, same @ChapterId scope, same chapter-homed-
   members-only restriction as usp_Member_ListForIdCardExport — see that procedure's own
   header for the full reasoning on all three; not repeated here. This proc shares NO
   column shape with it and must never be made to — that one's columns are keyed to the
   Magicard printer's own mail-merge template (its own header says so); this one's
   columns are keyed to DigitalIdCardRenderer.cs, a completely separate consumer.

   Mirrors usp_Credential_GetOrIssueForSelf's own SELECT shape (OfficePosition/OfficeBody,
   IsPaid, chapter mark) but for every in-scope chapter-homed member at once, and reading
   an EXISTING credential rather than issuing one — the caller is required to call
   usp_Credential_BulkIssueForExport first, in the same request, exactly like the Magicard
   export's own endpoint already does, so TokenSubject comes back non-null in practice.
   CityName is the member's chapter's own City/Municipal council — chapters are named with
   Greek letters, and the same name can recur under different municipalities, which is
   exactly why DigitalIdCardRenderer shows it on the card. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_ListForDigitalIdExport
    @RequestingMemberId INT,
    @ChapterId          INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL
      AND  cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51580, 'The National Council is not configured. Seed it before running a Digital ID export.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51581, 'Only the National Council Admin may run a Digital ID export.', 1;

    -- Same 09-Aug-anchored membership year every payment-tag-aware proc uses.
    DECLARE @CurrentMembershipYear INT;
    DECLARE @Anniversary DATE = DATEFROMPARTS(YEAR(@Today), 8, 8);
    SET @CurrentMembershipYear = CASE WHEN @Today > @Anniversary THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;

    ;WITH TargetMembers AS (
        SELECT  m.MemberId, m.MemberNumber, m.FirstName, m.MiddleName, m.LastName, m.GiftName,
                m.BloodTypeId, m.ChapterId, m.PhotoPath, m.PhotoContentType, m.StatusId
        FROM    dbo.Member m
        WHERE   m.IsDeleted = 0 AND m.ChapterId IS NOT NULL
          AND   (@ChapterId IS NULL OR m.ChapterId = @ChapterId)
    ),
    CouncilChain AS (
        SELECT  tm.MemberId, c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName
        FROM    TargetMembers tm
                JOIN dbo.Chapter ch      ON ch.ChapterId = tm.ChapterId
                JOIN dbo.Council c       ON c.CouncilId = ch.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        UNION ALL
        SELECT  cc.MemberId, p.CouncilId, p.ParentCouncilId, p.CouncilName, cl.LevelName
        FROM    CouncilChain cc
                JOIN dbo.Council p       ON p.CouncilId = cc.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = p.CouncilLevelId
    ),
    LatestTag AS (
        SELECT  MemberId, ActionType,
                ROW_NUMBER() OVER (PARTITION BY MemberId ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC) AS rn
        FROM    dbo.MemberPaymentTagAction
        WHERE   MembershipYear = @CurrentMembershipYear
    )
    SELECT  tm.MemberId, tm.MemberNumber,
            tm.FirstName, tm.MiddleName, tm.LastName, tm.GiftName,
            bt.BloodTypeName,
            tm.ChapterId, ch.ChapterName, ch.ChapterCode,
            MAX(CASE WHEN cc.LevelName = 'City/Municipal' THEN cc.CouncilName END) AS CityName,
            ms.StatusName,
            tm.PhotoPath, tm.PhotoContentType,
            pos.OfficeName AS OfficePosition, pos.OfficeBody AS OfficeBody,
            -- 'Free' (added 2026-10-06) suppresses the watermark exactly like 'Tagged' —
            -- see 27_member_payment_tag_free_status.sql's own header.
            CAST(CASE WHEN lt.ActionType IN ('Tagged', 'Free') THEN 1 ELSE 0 END AS BIT) AS IsPaid,
            ch.LogoPath AS ChapterLogoPath, ch.LogoContentType AS ChapterLogoContentType,
            ca.HexValue AS MarkAccentHex,
            mc.TokenSubject
    FROM    TargetMembers tm
            JOIN dbo.Chapter ch        ON ch.ChapterId = tm.ChapterId
            JOIN dbo.MemberStatus ms   ON ms.StatusId  = tm.StatusId
            LEFT JOIN dbo.BloodType bt ON bt.BloodTypeId = tm.BloodTypeId
            LEFT JOIN CouncilChain cc  ON cc.MemberId = tm.MemberId
            LEFT JOIN LatestTag lt     ON lt.MemberId = tm.MemberId AND lt.rn = 1
            LEFT JOIN dbo.ChapterAccent ca ON ca.AccentId = ch.MarkAccentId
            OUTER APPLY (
                SELECT TOP (1) x.OfficeName, x.OfficeBody
                FROM (
                    SELECT  co.OfficeName, c.CouncilName AS OfficeBody,
                            0 AS ScopeRank, cl.LevelOrder AS SortKey
                    FROM    dbo.MemberRole mr
                            JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = mr.CouncilOfficeId
                            JOIN dbo.Council c        ON c.CouncilId = mr.ScopeId
                            JOIN dbo.CouncilLevel cl  ON cl.CouncilLevelId = c.CouncilLevelId
                    WHERE   mr.MemberId = tm.MemberId AND mr.ScopeType = 'Council'
                      AND   mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                    UNION ALL
                    SELECT  o.OfficeName, ch2.ChapterName,
                            1, o.SortOrder
                    FROM    dbo.MemberRole mr
                            JOIN dbo.ChapterOffice o ON o.OfficeId = mr.OfficeId
                            JOIN dbo.Chapter ch2     ON ch2.ChapterId = mr.ScopeId
                    WHERE   mr.MemberId = tm.MemberId AND mr.ScopeType = 'Chapter'
                      AND   mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                ) x
                ORDER BY x.ScopeRank, x.SortKey
            ) pos
            LEFT JOIN dbo.MemberCredential mc
                   ON mc.MemberId = tm.MemberId
                  AND mc.RevokedDate IS NULL
                  AND mc.ExpiryDate > SYSUTCDATETIME()
    GROUP BY tm.MemberId, tm.MemberNumber, tm.FirstName, tm.MiddleName, tm.LastName, tm.GiftName,
             bt.BloodTypeName, tm.ChapterId, ch.ChapterName, ch.ChapterCode, ms.StatusName,
             tm.PhotoPath, tm.PhotoContentType, pos.OfficeName, pos.OfficeBody, lt.ActionType,
             ch.LogoPath, ch.LogoContentType, ca.HexValue, mc.TokenSubject
    ORDER BY ch.ChapterName, tm.LastName, tm.FirstName
    OPTION (MAXRECURSION 20);
END
GO
