/* One council's own officer roster — current seats, ended terms, and every
   dbo.SeatOverride ever recorded for it (permanent history, never filtered out —
   invariant #13b: "no waiver, no approval step, just a permanent record"). Scoped the
   same way usp_Council_GetRegistry is: @CouncilId must be inside the caller's own
   dbo.fn_MemberCouncilScope. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_GetRoster
    @RequestingMemberId INT,
    @CouncilId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.fn_MemberCouncilScope(@RequestingMemberId) sc WHERE sc.CouncilId = @CouncilId)
        THROW 51692, 'That council is outside what you are permitted to view.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    -- Set 1: every seat ever held on this council, current and ended, newest first.
    SELECT  mr.MemberRoleId, co.CouncilOfficeId, co.OfficeName, r.RoleName,
            m.MemberId, m.GiftName, m.MemberNumber,
            m.FirstName + N' ' + m.LastName AS FullName,
            ch.ChapterName AS HomeChapterName,
            mr.TermStart, mr.TermEnd,
            CAST(CASE WHEN mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                      THEN 1 ELSE 0 END AS BIT) AS IsCurrent,
            m.RenewedThrough,
            CAST(CASE WHEN ua.AccountId IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS HasAccount
    FROM    dbo.MemberRole mr
            JOIN dbo.Member m ON m.MemberId = mr.MemberId
            JOIN dbo.Role r ON r.RoleId = mr.RoleId
            LEFT JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = mr.CouncilOfficeId
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
            LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
    WHERE   mr.ScopeType = 'Council' AND mr.ScopeId = @CouncilId
    ORDER BY mr.TermStart DESC, mr.MemberRoleId DESC;

    -- Set 2: every SeatOverride recorded for this council — permanent, never hidden.
    SELECT  so.SeatOverrideId, so.MemberRoleId, m.GiftName, m.MemberNumber,
            ch.ChapterName AS HomeChapterName,
            so.Reason, so.SeatedOn,
            sb.GiftName AS SeatedByGiftName
    FROM    dbo.SeatOverride so
            JOIN dbo.Member m ON m.MemberId = so.MemberId
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = so.HomeChapterId
            JOIN dbo.Member sb ON sb.MemberId = so.SeatedBy
    WHERE   so.CouncilId = @CouncilId
    ORDER BY so.SeatedOn DESC;
END
GO
