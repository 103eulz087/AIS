/* ============================================================================
   National Council bootstrap — docs/AIS-Project-Documentation.md §7A.6,
   "Order of operations at go-live", step 2: "National seats its own officers,
   selected from the members created in step 1. The System Admin's
   organizational authority ends."

   There is no "superadmin" account anywhere in this application (confirmed:
   dbo.Member/dbo.UserAccount are the only login-capable tables, and the
   seeded-but-unused dbo.Role row 'SystemAdmin' must never be wired to any
   policy — see AuthorizationPolicies.cs's own "must NEVER add SystemAdmin
   here" comments). "System Admin" in the docs means whoever is running this
   script by hand with raw database access — the person doing that right now.
   Once this script seats National's first officer, that National CouncilAdmin
   IS the account with full Portal authority: the existing Councils screen
   (CouncilRegistry.tsx/CouncilRoster.tsx, usp_Council_SeatOfficer) already
   works generically for National, so seating further National Council users
   from here on needs no new UI/API — just this first seat.

   Why this can't call usp_Council_SeatOfficer: that procedure requires the
   @RequestingMemberId to ALREADY hold a live CouncilAdmin seat on the
   council being acted on (usp_Council_ResolveSeatingAuthority resolves
   National's own acting council to itself, since it has no parent — "National
   seats National"). For National's very first officer there is by definition
   nobody who already holds that seat, so the only way to produce it is the
   install script performing the identical inserts the procedure would have
   made (same tables, same audit trail — docs §7A.6's own words), once, by
   hand. This is NOT a second approval mechanism (the rejected alternative
   invariant #13a's own text warns against): nothing is added to the running
   application, and the capability is never available again after this run.

   Idempotent — safe to run from a clean slate OR as a continuation of a
   partially-completed earlier attempt. Checks what already exists at each
   step (Member -> Application -> Council seat -> handover) and only does
   what's left.

   Why Submit/Approve matter here too: usp_MembershipApplication_Submit's own
   duplicate-detection path calls ROLLBACK TRAN inside its CATCH block, and
   SQL Server flatly refuses ROLLBACK inside an INSERT...EXEC (Msg 3915) — so
   re-submitting when an open application already exists from an earlier
   attempt is not just wasteful, it's a hard error. This version never calls
   Submit unless nothing exists yet.
   ============================================================================ */
SET NOCOUNT ON;

PRINT '=== Current National Council roster (before this script) ===';
SELECT  mr.MemberRoleId, m.MemberId, m.GiftName, m.MemberNumber, co.OfficeName, r.RoleName,
        mr.TermStart, mr.TermEnd,
        CASE WHEN ua.AccountId IS NOT NULL THEN 'Has an account' ELSE 'No account yet' END AS AccountStatus
FROM    dbo.MemberRole mr
JOIN    dbo.Member m ON m.MemberId = mr.MemberId
JOIN    dbo.Role   r ON r.RoleId = mr.RoleId
JOIN    dbo.Council c ON c.CouncilId = mr.ScopeId AND mr.ScopeType = 'Council'
LEFT JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = mr.CouncilOfficeId
LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
WHERE   c.CouncilName = 'National Council';
PRINT '';

DECLARE @ChapterId INT = (SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = 'Brgy. San Isidro Chapter');
DECLARE @ChapterAdminId INT = (SELECT MemberId FROM dbo.Member WHERE MemberNumber = 'AKR-04-0117-001'); -- TANGLAW
DECLARE @NationalCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'National Council');
DECLARE @PresidentOfficeId INT = (SELECT CouncilOfficeId FROM dbo.CouncilOffice WHERE OfficeName = 'President');
DECLARE @CouncilAdminRoleId INT = (SELECT RoleId FROM dbo.CouncilOffice WHERE CouncilOfficeId = @PresidentOfficeId);

IF @ChapterId IS NULL OR @ChapterAdminId IS NULL OR @NationalCouncilId IS NULL
   OR @PresidentOfficeId IS NULL OR @CouncilAdminRoleId IS NULL
BEGIN
    PRINT 'Lookup failed — one of ChapterId/ChapterAdminId/NationalCouncilId/PresidentOfficeId/CouncilAdminRoleId was NULL. Stopping.';
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

-- Step 2: seat him as National President (CouncilAdmin), unless already seated.
-- Raw INSERT, not usp_Council_SeatOfficer — see the header comment for why.
IF EXISTS (
    SELECT 1 FROM dbo.MemberRole mr
    WHERE mr.MemberId = @NewMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
      AND mr.RoleId = @CouncilAdminRoleId
      AND (mr.TermEnd IS NULL OR mr.TermEnd >= CAST(SYSUTCDATETIME() AS DATE))
)
    PRINT 'Already seated as President (CouncilAdmin) on National Council.';
ELSE
BEGIN
    DECLARE @SeatToday DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @NewMemberRoleId INT;

    BEGIN TRAN;
        INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, CouncilOfficeId, TermStart, TermEnd)
        VALUES (@NewMemberId, @CouncilAdminRoleId, 'Council', @NationalCouncilId, @PresidentOfficeId, @SeatToday, NULL);
        SET @NewMemberRoleId = SCOPE_IDENTITY();

        -- RoutingReason has no CHECK constraint (NVARCHAR(40), comment-documented
        -- values only) — 'Bootstrap' is a fourth, install-script-only value alongside
        -- Parent/ParentDoesNotExist/ParentDormant/Override, matching what
        -- usp_Council_SeatOfficer itself would have written had it been callable here.
        -- ActorMemberId is NULL: nobody with standing in the application approved this
        -- seat — the install script did, directly, which is the entire point.
        INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId, Remarks)
        VALUES ('CouncilSeat', @NewMemberRoleId, @NationalCouncilId, @NationalCouncilId, 'Bootstrap', NULL,
                N'National Council had no seated officer anywhere above or at it — seated directly by install script per docs §7A.6, not through usp_Council_SeatOfficer.');

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MemberRole', CAST(@NewMemberRoleId AS NVARCHAR(40)), 'CouncilSeat',
                CONCAT(N'{"CouncilId":', @NationalCouncilId, N',"MemberId":', @NewMemberId,
                       N',"CouncilOfficeId":', @PresidentOfficeId, N',"RoutingReason":"Bootstrap"}'),
                NULL);

        -- The handover itself — docs §7A.6 "The System Admin handover": authority ends
        -- the MOMENT National seats a president, as a consequence of that seating, not
        -- an action taken separately. One-way; this row is never updated or deleted.
        IF NOT EXISTS (SELECT 1 FROM dbo.AuthorityHandover)
            INSERT dbo.AuthorityHandover (TriggeredByMemberRoleId, Notes)
            VALUES (@NewMemberRoleId,
                    N'National Council seated its first officer (President/CouncilAdmin, ' + @NewMemberNumber +
                    N'). Install-script bootstrap authority ends here, permanently, per docs §7A.6. ' +
                    N'From this point, National Council officers are seated the ordinary way — the ' +
                    N'Councils screen in the Portal, by a sitting National CouncilAdmin — never by ' +
                    N'this script again.');
    COMMIT;

    PRINT 'Seated on National Council as President/CouncilAdmin (MemberRoleId ' + CAST(@NewMemberRoleId AS NVARCHAR(20)) + ').';
    PRINT 'Authority handover recorded — this script''s own seating path must never be run again for National.';
END

PRINT '';
IF @issuedNewLink = 1
BEGIN
    PRINT '=== Enrolment link (SHOW-ONCE — save this now) ===';
    PRINT 'Expires: ' + CONVERT(NVARCHAR(30), @ExpiresOn, 126) + ' UTC';
    PRINT 'Live: https://alphakapparho.app/enrol/' + @rawToken;
    PRINT 'Local dev: https://localhost:5173/enrol/' + @rawToken;
END
ELSE
    PRINT 'No new enrolment link was needed — he already has an account.';

PRINT '';
PRINT '=== National Council roster (after this script) ===';
SELECT  mr.MemberRoleId, m.MemberId, m.GiftName, m.MemberNumber, co.OfficeName, r.RoleName, mr.TermStart, mr.TermEnd
FROM    dbo.MemberRole mr
JOIN    dbo.Member m ON m.MemberId = mr.MemberId
JOIN    dbo.Role   r ON r.RoleId = mr.RoleId
JOIN    dbo.Council c ON c.CouncilId = mr.ScopeId AND mr.ScopeType = 'Council'
LEFT JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = mr.CouncilOfficeId
WHERE   c.CouncilName = 'National Council';

PRINT '';
PRINT '=== Authority handover record ===';
SELECT * FROM dbo.AuthorityHandover;
