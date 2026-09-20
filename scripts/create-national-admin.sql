/* ============================================================================
   Idempotent version — safe to run from a clean slate OR as a continuation of a
   partially-completed earlier attempt. Checks what already exists at each step
   (Member -> Application -> Council seat) and only does what's left.

   Why this matters: usp_MembershipApplication_Submit's own duplicate-detection
   path (a second submit for the same chapter+mobile) calls ROLLBACK TRAN inside
   its CATCH block, and SQL Server flatly refuses ROLLBACK inside an INSERT...EXEC
   (Msg 3915) — so re-submitting when an open application already exists from an
   earlier attempt is not just wasteful, it's a hard error. This version never
   calls Submit unless nothing exists yet.
   ============================================================================ */
SET NOCOUNT ON;

PRINT '=== Current National Council roster (before this script) ===';
SELECT  mr.MemberRoleId, m.MemberId, m.GiftName, m.MemberNumber, r.RoleName,
        mr.TermStart, mr.TermEnd,
        CASE WHEN ua.AccountId IS NOT NULL THEN 'Has an account' ELSE 'No account yet' END AS AccountStatus
FROM    dbo.MemberRole mr
JOIN    dbo.Member m ON m.MemberId = mr.MemberId
JOIN    dbo.Role   r ON r.RoleId = mr.RoleId
JOIN    dbo.Council c ON c.CouncilId = mr.ScopeId AND mr.ScopeType = 'Council'
LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
WHERE   c.CouncilName = 'National Council';
PRINT '';

DECLARE @ChapterId INT = (SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = 'Brgy. San Isidro Chapter');
DECLARE @ChapterAdminId INT = (SELECT MemberId FROM dbo.Member WHERE MemberNumber = 'AKR-04-0117-001'); -- TANGLAW
DECLARE @NationalCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'National Council');
DECLARE @CouncilAdminRoleId INT = (SELECT RoleId FROM dbo.Role WHERE RoleName = 'CouncilAdmin');

IF @ChapterId IS NULL OR @ChapterAdminId IS NULL OR @NationalCouncilId IS NULL OR @CouncilAdminRoleId IS NULL
BEGIN
    PRINT 'Lookup failed — one of ChapterId/ChapterAdminId/NationalCouncilId/CouncilAdminRoleId was NULL. Stopping.';
    RETURN;
END

DECLARE @NewMemberId INT = (SELECT MemberId FROM dbo.Member WHERE MobileNo = N'09171234567' AND IsDeleted = 0);
DECLARE @NewMemberNumber NVARCHAR(30);
DECLARE @ExpiresOn DATETIME2 = NULL;
DECLARE @rawToken VARCHAR(64) = NULL;
DECLARE @issuedNewLink BIT = 0;

IF @NewMemberId IS NOT NULL
BEGIN
    SET @NewMemberNumber = (SELECT MemberNumber FROM dbo.Member WHERE MemberId = @NewMemberId);
    PRINT 'Member already exists: ' + @NewMemberNumber + ' (MemberId ' + CAST(@NewMemberId AS NVARCHAR(20)) + ') — skipping submit/approve.';

    -- If he was created but never redeemed his account, get him a fresh link.
    -- usp_Enrolment_Issue invalidates any previous un-redeemed link for this
    -- member before issuing a new one, so this is always safe to call.
    IF NOT EXISTS (SELECT 1 FROM dbo.UserAccount WHERE MemberId = @NewMemberId)
    BEGIN
        DECLARE @randomBytes1 VARBINARY(32) = CRYPT_GEN_RANDOM(32);
        DECLARE @base64_1 VARCHAR(MAX) = CAST(N'' AS XML).value('xs:base64Binary(sql:variable("@randomBytes1"))', 'VARCHAR(MAX)');
        SET @rawToken = REPLACE(REPLACE(REPLACE(@base64_1, '=', ''), '+', '-'), '/', '_');
        DECLARE @tokenHash1 VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(VARBINARY(MAX), @rawToken));
        DECLARE @LinkId1 INT, @ExpiresOn1 DATETIME2;

        EXEC dbo.usp_Enrolment_Issue
            @MemberId = @NewMemberId,
            @IssuedBy = @ChapterAdminId,
            @TokenHash = @tokenHash1,
            @LinkId = @LinkId1 OUTPUT,
            @ExpiresOnOut = @ExpiresOn1 OUTPUT;

        SET @ExpiresOn = @ExpiresOn1;
        SET @issuedNewLink = 1;
        PRINT 'No account yet — issued a fresh enrolment link.';
    END
    ELSE
        PRINT 'He already has an account — no new link needed.';
END
ELSE
BEGIN
    DECLARE @ApplicationId INT;
    SELECT @ApplicationId = ApplicationId
    FROM   dbo.MembershipApplication
    WHERE  ChapterId = @ChapterId AND MobileNo = N'09171234567' AND IsOpen = 1;

    IF @ApplicationId IS NULL
    BEGIN
        DECLARE @ReferenceNoTable TABLE (ReferenceNo NVARCHAR(20));
        INSERT INTO @ReferenceNoTable
        EXEC dbo.usp_MembershipApplication_Submit
            @ChapterId = @ChapterId,
            @FirstName = N'National',
            @MiddleName = NULL,
            @LastName = N'Admin',
            @GiftName = N'TANGLAW-NAT',
            @BirthDate = '1975-01-01',
            @MobileNo = N'09171234567',
            @Email = NULL,
            @DateSurvive = NULL,
            @PresidentDuringSurvive = NULL,
            @MasterInitiatorDuringSurvive = NULL,
            @SeconderNameGiven = N'TANGLAW',
            @SeconderMemberNumberGiven = N'AKR-04-0117-001';

        DECLARE @ReferenceNo NVARCHAR(20) = (SELECT TOP (1) ReferenceNo FROM @ReferenceNoTable);
        SET @ApplicationId = (SELECT ApplicationId FROM dbo.MembershipApplication WHERE ReferenceNo = @ReferenceNo);
        PRINT 'Application submitted: ' + @ReferenceNo + ' (ApplicationId ' + CAST(@ApplicationId AS NVARCHAR(20)) + ')';
    END
    ELSE
        PRINT 'An open application already exists from an earlier attempt (ApplicationId ' + CAST(@ApplicationId AS NVARCHAR(20)) + ') — approving it directly.';

    DECLARE @randomBytes2 VARBINARY(32) = CRYPT_GEN_RANDOM(32);
    DECLARE @base64_2 VARCHAR(MAX) = CAST(N'' AS XML).value('xs:base64Binary(sql:variable("@randomBytes2"))', 'VARCHAR(MAX)');
    SET @rawToken = REPLACE(REPLACE(REPLACE(@base64_2, '=', ''), '+', '-'), '/', '_');
    DECLARE @tokenHash2 VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(VARBINARY(MAX), @rawToken));

    DECLARE @ApproveResult TABLE (MemberId INT, MemberNumber NVARCHAR(30), LinkId INT, ExpiresOn DATETIME2);
    INSERT INTO @ApproveResult
    EXEC dbo.usp_MembershipApplication_Approve
        @ApplicationId = @ApplicationId,
        @RequestingMemberId = @ChapterAdminId,
        @SeconderMemberId = @ChapterAdminId,
        @TokenHash = @tokenHash2;

    SET @NewMemberId = (SELECT TOP (1) MemberId FROM @ApproveResult);
    SET @NewMemberNumber = (SELECT TOP (1) MemberNumber FROM @ApproveResult);
    SET @ExpiresOn = (SELECT TOP (1) ExpiresOn FROM @ApproveResult);
    SET @issuedNewLink = 1;

    PRINT 'Member approved: ' + @NewMemberNumber + ' (MemberId ' + CAST(@NewMemberId AS NVARCHAR(20)) + ')';
END

-- Step 2: seat him CouncilAdmin at National, unless already seated.
IF EXISTS (
    SELECT 1 FROM dbo.MemberRole mr
    WHERE mr.MemberId = @NewMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
      AND mr.RoleId = @CouncilAdminRoleId
      AND (mr.TermEnd IS NULL OR mr.TermEnd >= CAST(SYSUTCDATETIME() AS DATE))
)
    PRINT 'Already seated as CouncilAdmin on National Council.';
ELSE
BEGIN
    DECLARE @SeatResult TABLE (MemberRoleId INT, WasInJurisdiction BIT);
    INSERT INTO @SeatResult
    EXEC dbo.usp_Council_SeatOfficer
        @RequestingMemberId = @ChapterAdminId,
        @CouncilId = @NationalCouncilId,
        @MemberId = @NewMemberId,
        @RoleId = @CouncilAdminRoleId,
        @TermStart = '2026-09-20',
        @TermEnd = NULL;

    DECLARE @NewMemberRoleId INT = (SELECT TOP (1) MemberRoleId FROM @SeatResult);
    PRINT 'Seated on National Council as CouncilAdmin (MemberRoleId ' + CAST(@NewMemberRoleId AS NVARCHAR(20)) + ').';
END

PRINT '';
IF @issuedNewLink = 1
BEGIN
    PRINT '=== Enrolment link (SHOW-ONCE — save this now) ===';
    PRINT 'Expires: ' + CONVERT(NVARCHAR(30), @ExpiresOn, 126) + ' UTC';
    PRINT 'Staging: https://itcoreapps.com/enrol/' + @rawToken;
    PRINT 'Local dev: https://localhost:5173/enrol/' + @rawToken;
END
ELSE
    PRINT 'No new enrolment link was needed — he already has an account.';

PRINT '';
PRINT '=== National Council roster (after this script) ===';
SELECT  mr.MemberRoleId, m.MemberId, m.GiftName, m.MemberNumber, r.RoleName, mr.TermStart, mr.TermEnd
FROM    dbo.MemberRole mr
JOIN    dbo.Member m ON m.MemberId = mr.MemberId
JOIN    dbo.Role   r ON r.RoleId = mr.RoleId
JOIN    dbo.Council c ON c.CouncilId = mr.ScopeId AND mr.ScopeType = 'Council'
WHERE   c.CouncilName = 'National Council';
