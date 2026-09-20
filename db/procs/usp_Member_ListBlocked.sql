/* Currently-blocked members, for the National Council screen that reviews and unblocks
   them — without this, usp_Member_Block would be a write-only action nobody could ever
   review or reverse from the UI. National Council only, same authorization shape as
   usp_Member_Block/_Unblock/_ResetPassword.

   "Currently blocked" is derived from dbo.MemberAccountAction itself (the member's own
   most recent Blocked/Unblocked row is 'Blocked'), not from dbo.UserAccount.IsDisabled —
   a member blocked before he ever redeemed his first enrolment link has no UserAccount
   row at all yet, and must still show up here. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_ListBlocked
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
        JOIN   dbo.Role r ON r.RoleId = mr.RoleId
        JOIN   dbo.Council c ON c.CouncilId = mr.ScopeId AND mr.ScopeType = 'Council'
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  r.RoleName   = 'CouncilAdmin'
          AND  c.ParentCouncilId IS NULL
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51640, 'Only National Council may view blocked accounts.', 1;

    ;WITH LatestAction AS (
        SELECT  MemberId, ActionType, Reason, PerformedBy, PerformedDate,
                ROW_NUMBER() OVER (PARTITION BY MemberId ORDER BY PerformedDate DESC, MemberAccountActionId DESC) AS rn
        FROM    dbo.MemberAccountAction
        WHERE   ActionType IN ('Blocked', 'Unblocked')
    )
    SELECT  m.MemberId, m.GiftName, m.MemberNumber, ch.ChapterName,
            la.Reason, la.PerformedDate, pb.GiftName AS BlockedByGiftName
    FROM    LatestAction la
    JOIN    dbo.Member m ON m.MemberId = la.MemberId AND m.IsDeleted = 0
    LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
    LEFT JOIN dbo.Member pb ON pb.MemberId = la.PerformedBy
    WHERE   la.rn = 1 AND la.ActionType = 'Blocked'
    ORDER BY la.PerformedDate DESC;
END
GO
