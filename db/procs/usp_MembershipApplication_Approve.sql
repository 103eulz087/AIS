/* THE centerpiece of this module, and the ONLY INSERT path into dbo.Member anywhere in
   this codebase (CLAUDE.md §2 invariant #13 — members are created by chapters only).
   One transaction: allocate the member number, create the member, seat him in the plain
   'Member' role, issue his enrolment link, decide the application, record the history,
   audit it — or none of it.

   MEMBER-NUMBER RACE SAFETY. dbo.Chapter.NextMemberSeq is captured and incremented in the
   SAME UPDATE statement (@Seq = NextMemberSeq, NextMemberSeq = NextMemberSeq + 1 — all
   assignments in a SET list read the row's PRE-update values), never a SELECT followed by
   a separate UPDATE. Two concurrent approvals for the same chapter serialize on that row's
   lock: whichever transaction's UPDATE runs second simply gets the NEXT value, never a
   duplicate. This is the same category of fix as usp_Meeting_SaveAttendance's finalize
   race (see that proc's header comment) — read-then-write-elsewhere is the bug; capture
   and mutate in one statement is the fix.

   ATOMICITY — "any failure leaves zero rows anywhere". SET XACT_ABORT ON means any error
   from this point on unwinds the ENTIRE transaction, including the NextMemberSeq
   increment above (so a failed approval never burns a member-number slot) and the Member/
   MemberRole rows already inserted in this same batch. The one call that reaches outside
   this proc's own statements — usp_Enrolment_Issue — is invoked via INSERT...EXEC (its own
   BEGIN TRAN/COMMIT nest inside this one; SQL Server does not actually commit a nested
   transaction until the outermost COMMIT runs) with SET XACT_ABORT ON in EFFECT THERE TOO,
   so an error inside it aborts this whole batch exactly the same way. Could it actually
   throw here? Its two guard checks are (a) the member has a MobileNo — guaranteed, since
   @MobileNo on the application is NOT NULL and is copied straight onto the new Member row
   a few statements above, and (b) the member holds SOME currently-active MemberRole — also
   guaranteed, since the INSERT dbo.MemberRole immediately above this call sets TermStart to
   TODAY with no TermEnd, in the SAME transaction, using the SAME @Today this proc computes.
   The one theoretical gap is a UTC-midnight crossing between this proc's @Today and
   usp_Enrolment_Issue's own (it computes its own @Today independently) — a multi-hour
   business transaction could theoretically straddle midnight and see the two disagree by
   a day, but that would only make the check FAIL SAFE (throw, roll everything back, retry)
   never succeed incorrectly, and a single stored-procedure call completing across a UTC
   midnight boundary is not a realistic timing to defend further against here. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_Approve
    @ApplicationId INT,
    @RequestingMemberId INT,
    @SeconderMemberId INT = NULL,
    @TokenHash VARBINARY(32),
    @ExpiresOn DATETIME2 = NULL,
    -- DRY-RUN ONLY (Akrho.Infrastructure.Security.DryRunDefaults). Forwarded verbatim to
    -- the usp_Enrolment_Issue call below — NULL preserves the original, hardened behaviour.
    @DefaultPasswordHash NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @ChapterId INT, @StatusId INT,
            @FirstName NVARCHAR(80), @MiddleName NVARCHAR(80), @LastName NVARCHAR(80),
            @GiftName NVARCHAR(60), @BirthDate DATE, @MobileNo NVARCHAR(30), @Email NVARCHAR(200),
            @DateSurvive DATE, @PresidentDuringSurvive NVARCHAR(200), @MasterInitiatorDuringSurvive NVARCHAR(200),
            @AppSeconderMemberId INT;

    SELECT  @ChapterId = ChapterId, @StatusId = StatusId,
            @FirstName = FirstName, @MiddleName = MiddleName, @LastName = LastName,
            @GiftName = GiftName, @BirthDate = BirthDate, @MobileNo = MobileNo, @Email = Email,
            @DateSurvive = DateSurvive, @PresidentDuringSurvive = PresidentDuringSurvive,
            @MasterInitiatorDuringSurvive = MasterInitiatorDuringSurvive,
            @AppSeconderMemberId = SeconderMemberId
    FROM    dbo.MembershipApplication
    WHERE   ApplicationId = @ApplicationId;

    IF @ChapterId IS NULL
        THROW 51223, 'Application not found.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role   r ON r.RoleId = mr.RoleId
        JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName = 'ChapterAdmin'
    )
        THROW 51224, 'Only the chapter admin may decide this application.', 1;

    DECLARE @PendingApprovalId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'PendingApproval');
    IF @StatusId <> @PendingApprovalId
        THROW 51225, 'This application has already been decided.', 1;

    /* Mobile-number uniqueness guard — dry-run decision: mobile number now doubles as an
       alternate sign-in identifier (usp_Auth_GetAccountForSignIn), so two members sharing
       one would make sign-in-by-mobile ambiguous. Same check repeated in
       usp_ChapterRegistration_Approve's Charter branch and usp_Member_UpdateOwnProfile
       for the other two paths a Member row's MobileNo can come from. */
    IF EXISTS (SELECT 1 FROM dbo.Member WHERE MobileNo = @MobileNo AND IsDeleted = 0)
        THROW 51237, 'That mobile number is already registered to another member. Ask the applicant to confirm his own number before approving.', 1;

    /* @SeconderMemberId overrides whatever (if anything) was already recorded on the
       application — this is the admin's authenticated confirmation of who the free-text
       seconder actually is. Validated for real, unlike the free-text fields at submission. */
    IF @SeconderMemberId IS NULL SET @SeconderMemberId = @AppSeconderMemberId;
    IF @SeconderMemberId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.Member WHERE MemberId = @SeconderMemberId AND IsDeleted = 0
    )
        THROW 51226, 'Seconder member not found.', 1;

    DECLARE @ApprovedId INT = (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'Approved');
    DECLARE @ActiveStatusId INT = (SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = 'Active');
    DECLARE @MemberRoleId INT = (SELECT RoleId FROM dbo.Role WHERE RoleName = 'Member');

    DECLARE @Seq INT, @Prefix NVARCHAR(12), @NewMemberId INT, @MemberNumber NVARCHAR(30);
    DECLARE @LinkId INT, @ExpiresOnOut DATETIME2;
    DECLARE @EnrolResult TABLE (LinkId INT, ExpiresOn DATETIME2);

    BEGIN TRAN;
        /* Capture-and-increment in one statement — see header comment. Both @Seq and
           @Prefix are read from the SAME pre-update row image, under the row's lock, so
           there is no separate read to race against. */
        UPDATE dbo.Chapter
           SET @Prefix = MemberNumberPrefix,
               @Seq    = NextMemberSeq,
               NextMemberSeq = NextMemberSeq + 1
         WHERE ChapterId = @ChapterId;

        IF @Prefix IS NULL
            THROW 51227, 'This chapter has no member-number prefix configured. Set one before approving members.', 1;

        /* 3-digit sequence, matching the demo/seeded numbering scheme (AKR-RR-CCCC-NNN,
           NNN = 001..999 — see db/seed/02_demo_chapter.sql). Throw rather than silently
           truncate or wrap once a chapter's roster would exceed what 3 digits can hold —
           a chapter this large is itself the thing to notice, not paper over. */
        IF @Seq > 999
            THROW 51228, 'This chapter has reached its maximum member number (999) under the current numbering scheme.', 1;

        SET @MemberNumber = CONCAT(@Prefix, '-', RIGHT('000' + CAST(@Seq AS NVARCHAR(10)), 3));

        INSERT dbo.Member (
            ChapterId, MemberNumber, FirstName, MiddleName, LastName, GiftName, Birthdate,
            DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
            MobileNo, Email, StatusId, RenewedThrough,
            SeconderMemberId, SeconderConfirmedDate, ApprovedBy, ApprovedDate, IsDeleted)
        VALUES (
            @ChapterId, @MemberNumber, @FirstName, @MiddleName, @LastName, @GiftName, @BirthDate,
            @DateSurvive, @PresidentDuringSurvive, @MasterInitiatorDuringSurvive,
            @MobileNo, @Email, @ActiveStatusId, NULL,   -- RenewedThrough NULL: no council has renewed him. Never fabricated.
            @SeconderMemberId, CASE WHEN @SeconderMemberId IS NOT NULL THEN SYSUTCDATETIME() END,
            @RequestingMemberId, SYSUTCDATETIME(), 0);

        SET @NewMemberId = SCOPE_IDENTITY();

        INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
        VALUES (@NewMemberId, @MemberRoleId, 'Chapter', @ChapterId, @Today, NULL);

        /* INSERT...EXEC to keep this proc's own result stream to a single, predictable
           final SELECT — same pattern usp_Meeting_Reopen and usp_Donation_Void/_Expense_Void
           already use around usp_Ledger_Reverse. The OUTPUT params exist so this capture
           does not ALSO require parsing that result set; both are populated from the
           same call for belt-and-braces, but only the OUTPUT params are read below. */
        INSERT INTO @EnrolResult (LinkId, ExpiresOn)
        EXEC dbo.usp_Enrolment_Issue
            @MemberId = @NewMemberId,
            @IssuedBy = @RequestingMemberId,
            @TokenHash = @TokenHash,
            @ExpiresOn = @ExpiresOn,
            @LinkId = @LinkId OUTPUT,
            @ExpiresOnOut = @ExpiresOnOut OUTPUT,
            @DefaultPasswordHash = @DefaultPasswordHash;

        UPDATE dbo.MembershipApplication
           SET StatusId = @ApprovedId, IsOpen = 0,
               DecidedBy = @RequestingMemberId, DecidedDate = SYSUTCDATETIME(),
               CreatedMemberId = @NewMemberId, SeconderMemberId = @SeconderMemberId
         WHERE ApplicationId = @ApplicationId;

        INSERT dbo.MembershipApplicationUpdate (ApplicationId, UpdatedBy, StatusId, Notes)
        VALUES (@ApplicationId, @RequestingMemberId, @ApprovedId,
                CONCAT(N'Approved. Member number ', @MemberNumber, N' assigned.'));

        -- AuditLog.Action is NVARCHAR(20) — 'ApprovedFromApplication' (23 chars) doesn't
        -- fit. 'Approve' matches the short-verb convention every other proc's audit rows
        -- already use (Create/Void/Reverse/Finalize/Reopen); the ApplicationId in
        -- NewValues carries the "from an application" context instead.
        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Member', CAST(@NewMemberId AS NVARCHAR(40)), 'Approve',
                CONCAT(N'{"ApplicationId":', @ApplicationId, N',"MemberId":', @NewMemberId,
                       N',"MemberNumber":"', @MemberNumber, N'"}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @NewMemberId AS MemberId, @MemberNumber AS MemberNumber,
           @LinkId AS LinkId, @ExpiresOnOut AS ExpiresOn;
END
GO
