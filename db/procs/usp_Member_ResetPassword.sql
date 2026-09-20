/* Forces a password reset for an EXISTING member's account — National Council only
   (client decision 2026-09-21). This is deliberately new ground: usp_Enrolment_Issue's
   own "bounded council issuer" branch is explicitly first-credential-only, and its own
   header explains why it must never become a re-issue path for an already-active
   account — "any council officer may manage the login of any member anywhere beneath it,
   forever" is exactly the standing power this codebase has refused to build. This proc
   exists anyway, narrowed to the one seat at the top of the tree, because the client
   explicitly asked for and authorized it — usp_Enrolment_Issue itself is UNCHANGED, its
   own guard is not weakened, and every other caller of it behaves exactly as before.

   Never a password itself — CLAUDE.md invariant #16 — only ever a fresh one-time
   enrolment link, same SHOW-ONCE convention as everywhere else this codebase issues one.
   The backend generates the raw token and its hash; this proc only ever sees the hash.

   A REAL reset, not merely an extra way in: the account is locked (IsDisabled = 1) the
   moment this runs, and any live session is torn down (usp_RefreshToken_RevokeFamily) —
   the old password stops working immediately. This is self-correcting:
   usp_Enrolment_Redeem already clears IsDisabled back to 0 the moment the member
   redeems this new link and sets his own password, so no separate "unlock" step is
   needed once he does. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_ResetPassword
    @RequestingMemberId INT,
    @MemberId           INT,
    @Reason             NVARCHAR(300),
    @TokenHash          VARBINARY(32),
    @ExpiresOn          DATETIME2 = NULL,     -- defaults to 72 hours from now
    @LinkId             INT = NULL OUTPUT,
    @ExpiresOnOut       DATETIME2 = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51636, 'A reason is required.', 1;

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
        THROW 51637, 'Only National Council may reset a member''s password.', 1;

    DECLARE @MobileNo NVARCHAR(30);
    SELECT @MobileNo = MobileNo FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0;
    IF @MobileNo IS NULL
        THROW 51638, 'Member not found, or has no mobile number on file.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole
        WHERE  MemberId = @MemberId
          AND  TermStart <= @Today AND (TermEnd IS NULL OR TermEnd >= @Today)
    )
        THROW 51639, 'This member does not currently hold any role, so there is no account to reset.', 1;

    IF @ExpiresOn IS NULL SET @ExpiresOn = DATEADD(HOUR, 72, SYSUTCDATETIME());

    DECLARE @NewLinkId INT;
    DECLARE @AccountId INT = (SELECT AccountId FROM dbo.UserAccount WHERE MemberId = @MemberId);

    BEGIN TRAN;
        -- Same "invalidate then insert" idiom as usp_Enrolment_Issue — never more than
        -- one live link per member (UQ_EnrolmentLink_ActivePerMember).
        UPDATE dbo.EnrolmentLink
           SET InvalidatedOn = SYSUTCDATETIME(),
               InvalidatedReason = N'Superseded by a National Council password reset'
         WHERE MemberId = @MemberId AND RedeemedOn IS NULL AND InvalidatedOn IS NULL;

        INSERT dbo.EnrolmentLink (MemberId, TokenHash, MobileNoAtIssue, IssuedBy, ExpiresOn)
        VALUES (@MemberId, @TokenHash, @MobileNo, @RequestingMemberId, @ExpiresOn);

        SET @NewLinkId = SCOPE_IDENTITY();

        IF @AccountId IS NOT NULL
        BEGIN
            UPDATE dbo.UserAccount SET IsDisabled = 1 WHERE MemberId = @MemberId;
            EXEC dbo.usp_RefreshToken_RevokeFamily @AccountId = @AccountId, @Reason = N'Password reset by National Council';
        END

        INSERT dbo.MemberAccountAction (MemberId, ActionType, Reason, PerformedBy)
        VALUES (@MemberId, 'PasswordReset', @Reason, @RequestingMemberId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('EnrolmentLink', CAST(@NewLinkId AS NVARCHAR(40)), 'PasswordReset',
                CONCAT(N'{"MemberId":', @MemberId, N',"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'),
                @RequestingMemberId);
    COMMIT;

    SET @LinkId = @NewLinkId;
    SET @ExpiresOnOut = @ExpiresOn;

    SELECT @NewLinkId AS LinkId, @ExpiresOn AS ExpiresOn;
END
GO
