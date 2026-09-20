/* Blocks a member's own login — National Council only (client decision 2026-09-21,
   deliberately narrower than "any council within its own subtree": see
   usp_Enrolment_Issue's own header on why a standing power to manage any member's
   account anywhere beneath a council is the thing this codebase has consistently
   refused to build; narrowing the exposure to the single seat at the very top of the
   tree, rather than removing it, is the compromise the client chose).

   Deliberately kept OUTSIDE dbo.CorrectiveAction — see db/schema/21_member_account_actions.sql's
   own header for why blocking a login is not the same act as disciplining a member.

   Mechanics: flips the existing (until now never-written) dbo.UserAccount.IsDisabled to
   1 — already enforced at sign-in/refresh/push (see AuthEndpoints.SignIn,
   usp_RefreshToken_Rotate, usp_PushSubscription_GetForMember). Also invalidates any
   outstanding (unredeemed) enrolment link, so a not-yet-enrolled member cannot sidestep
   the block by redeeming a pending first-time link, and revokes any live refresh-token
   family so an already-signed-in session cannot keep working. A member with no
   dbo.UserAccount row yet still gets the block recorded and his pending link (if any)
   invalidated — there is simply no IsDisabled row to flip. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_Block
    @RequestingMemberId INT,
    @MemberId           INT,
    @Reason             NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51630, 'A reason is required.', 1;

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
        THROW 51631, 'Only National Council may block a member''s account.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51632, 'Member not found.', 1;

    DECLARE @AccountId INT = (SELECT AccountId FROM dbo.UserAccount WHERE MemberId = @MemberId);

    BEGIN TRAN;
        IF @AccountId IS NOT NULL
        BEGIN
            UPDATE dbo.UserAccount SET IsDisabled = 1 WHERE MemberId = @MemberId;
            EXEC dbo.usp_RefreshToken_RevokeFamily @AccountId = @AccountId, @Reason = N'Account blocked';
        END

        UPDATE dbo.EnrolmentLink
           SET InvalidatedOn = SYSUTCDATETIME(), InvalidatedReason = N'Account blocked'
         WHERE MemberId = @MemberId AND RedeemedOn IS NULL AND InvalidatedOn IS NULL;

        INSERT dbo.MemberAccountAction (MemberId, ActionType, Reason, PerformedBy)
        VALUES (@MemberId, 'Blocked', @Reason, @RequestingMemberId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Member', CAST(@MemberId AS NVARCHAR(40)), 'Block',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;
END
GO
