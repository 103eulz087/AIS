/* The Paid/Unpaid/Free report (client decision 2026-10-06) — one row per chapter (or, with
   @ChapterId given, just that one), counting its active members by current payment-tag
   status for a membership year. Same National-only authority as the rest of this module;
   same "no action row = Unpaid" default usp_MemberPaymentTag_ListMembers already uses.
   Chapter-homed members only — a detached, council-homed member has no chapter for a
   per-chapter report to group him under. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberPaymentTag_GetStats
    @RequestingMemberId INT,
    @ChapterId          INT = NULL,
    @MembershipYear     INT = NULL
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
        THROW 51911, 'Only the National Council Admin may view the payment tag report.', 1;

    IF @ChapterId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId)
        THROW 51912, 'Chapter not found.', 1;

    ;WITH LatestAction AS (
        SELECT  MemberId, ActionType,
                ROW_NUMBER() OVER (PARTITION BY MemberId ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC) AS rn
        FROM    dbo.MemberPaymentTagAction
        WHERE   MembershipYear = @MembershipYear
    ),
    MemberStatus_ AS (
        SELECT  m.MemberId, m.ChapterId,
                CASE la.ActionType WHEN 'Tagged' THEN 'Paid' WHEN 'Free' THEN 'Free' ELSE 'Unpaid' END AS PaymentStatus
        FROM    dbo.Member m
                LEFT JOIN LatestAction la ON la.MemberId = m.MemberId AND la.rn = 1
        WHERE   m.IsDeleted = 0 AND m.ChapterId IS NOT NULL
          AND   (@ChapterId IS NULL OR m.ChapterId = @ChapterId)
    )
    SELECT  ch.ChapterId, ch.ChapterName,
            COUNT(*) AS TotalMembers,
            SUM(CASE WHEN ms.PaymentStatus = 'Paid'   THEN 1 ELSE 0 END) AS PaidCount,
            SUM(CASE WHEN ms.PaymentStatus = 'Free'   THEN 1 ELSE 0 END) AS FreeCount,
            SUM(CASE WHEN ms.PaymentStatus = 'Unpaid' THEN 1 ELSE 0 END) AS UnpaidCount,
            @MembershipYear AS MembershipYear
    FROM    MemberStatus_ ms
            JOIN dbo.Chapter ch ON ch.ChapterId = ms.ChapterId
    GROUP BY ch.ChapterId, ch.ChapterName
    ORDER BY ch.ChapterName;
END
GO
