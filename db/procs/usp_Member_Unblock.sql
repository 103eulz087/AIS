/* Reverses usp_Member_Block — National Council only, same authorization shape and same
   reasoning; see that proc's own header. Clears IsDisabled plus any stale
   FailedAttempts/LockedUntil left over from before the block, same "clean slate" fields
   usp_Enrolment_Redeem already clears on a normal redemption. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_Unblock
    @RequestingMemberId INT,
    @MemberId           INT,
    @Reason             NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51633, 'A reason is required.', 1;

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
        THROW 51634, 'Only National Council may unblock a member''s account.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.UserAccount WHERE MemberId = @MemberId)
        THROW 51635, 'This member has no account to unblock.', 1;

    BEGIN TRAN;
        UPDATE dbo.UserAccount
           SET IsDisabled = 0, FailedAttempts = 0, LockedUntil = NULL
         WHERE MemberId = @MemberId;

        INSERT dbo.MemberAccountAction (MemberId, ActionType, Reason, PerformedBy)
        VALUES (@MemberId, 'Unblocked', @Reason, @RequestingMemberId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Member', CAST(@MemberId AS NVARCHAR(40)), 'Unblock',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;
END
GO
