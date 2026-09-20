/* THE centerpiece of this module. One proc, branching internally on RegistrationType —
   built to match usp_MembershipApplication_Approve.sql's atomicity/locking discipline
   exactly: SET XACT_ABORT ON, one transaction, "any failure leaves zero rows anywhere."

   SIGNATURE NOTE — @TurnoverTokenHashes. The brief's own draft signature ended in an
   ellipsis ("@TokenHash VARBINARY(32), @ExpiresOn DATETIME2 = NULL, ...") because a
   single scalar token hash cannot serve the Turnover branch: several different incoming
   officers can each need their OWN brand-new enrolment link in the SAME approval, each
   requiring a cryptographically distinct hash (dbo.EnrolmentLink.TokenHash is UNIQUE).
   @TokenHash/@ExpiresOn remain exactly as specified for the Charter branch (the
   President's one link); @TurnoverTokenHashes (dbo.MemberTokenHashRow, see
   db/procs/00_types.sql) carries one (MemberId, TokenHash) row per NEW account the
   Turnover branch must create. A member keeping an account he already has needs no row
   here at all.

   GUARDS, both branches:
     - caller currently seated CouncilAdmin (decision E1b's approver role — distinct
       from CouncilSecretary, which only verifies) on ActingCouncilId;
     - StatusId = Submitted;
     - ALL EIGHT officers verified (VerifiedBy IS NOT NULL) — THROWs with a clear count
       ("5 of 8 verified") rather than a bare rejection. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_Approve
    @RegistrationId INT,
    @RequestingMemberId INT,
    @TokenHash VARBINARY(32) = NULL,
    @ExpiresOn DATETIME2 = NULL,
    @TurnoverTokenHashes dbo.MemberTokenHashRow READONLY,
    -- DRY-RUN ONLY (Akrho.Infrastructure.Security.DryRunDefaults). Forwarded verbatim to
    -- every usp_Enrolment_Issue call this proc makes (Charter's President; Turnover's
    -- new-account officers) — NULL preserves the original, hardened behaviour.
    @DefaultPasswordHash NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @RegistrationType NVARCHAR(10), @ActingCouncilId INT, @StatusId INT,
            @ChapterId INT, @ProposedChapterName NVARCHAR(150), @Barangay NVARCHAR(100),
            @RegionId INT, @ProvinceId INT, @MunicipalityId INT, @MarkAccentId INT,
            @IntendedCouncilId INT, @SubmittedByMemberId INT;

    SELECT  @RegistrationType = RegistrationType, @ActingCouncilId = ActingCouncilId,
            @StatusId = StatusId, @ChapterId = ChapterId, @ProposedChapterName = ProposedChapterName,
            @Barangay = Barangay, @RegionId = RegionId, @ProvinceId = ProvinceId,
            @MunicipalityId = MunicipalityId, @MarkAccentId = MarkAccentId,
            @IntendedCouncilId = IntendedCouncilId, @SubmittedByMemberId = SubmittedByMemberId
    FROM    dbo.ChapterRegistration
    WHERE   RegistrationId = @RegistrationId;

    IF @ActingCouncilId IS NULL
        THROW 51560, 'Registration not found.', 1;

    DECLARE @SubmittedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Submitted');
    IF @StatusId <> @SubmittedId
        THROW 51561, 'This registration has already been decided.', 1;

    /* Two-person control (decision E1b): the Secretary (or the admin) verifies officers
       individually; final approval is CouncilAdmin ONLY — a distinct, narrower
       capability from verification. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr
        JOIN   dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51562, 'Only this council''s President may give final approval.', 1;

    -- Compared against how many officers this REGISTRATION actually submitted, never
    -- dbo.ChapterOffice's own row count (8) — a Charter registration can legitimately
    -- submit fewer than 8 now (President-only is valid; see
    -- usp_ChapterRegistration_Submit's own header). Comparing against a fixed 8 here
    -- would mean a partial roster could never accumulate enough verifications to reach
    -- @OfficeCount and could NEVER be approved. Turnover still always submits all 8
    -- (usp_ChapterRegistration_SubmitTurnover is unchanged), so this same comparison is
    -- still correct there too — it was never actually about the office catalog's size,
    -- only about "has everyone ON THIS REGISTRATION been verified".
    DECLARE @OfficeCount INT = (
        SELECT COUNT(*) FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @RegistrationId);
    DECLARE @VerifiedCount INT = (
        SELECT COUNT(*) FROM dbo.ChapterRegistrationOfficer
        WHERE RegistrationId = @RegistrationId AND VerifiedBy IS NOT NULL);

    IF @VerifiedCount < @OfficeCount
    BEGIN
        -- THROW accepts a variable message (NVARCHAR(2048)), so the exact count is
        -- surfaced directly — "5 of 8 verified" — rather than a bare rejection.
        DECLARE @VerifyMsg NVARCHAR(200) = CONCAT(N'Not every officer has been verified yet (',
            @VerifiedCount, N' of ', @OfficeCount, N' verified). Every officer must be verified before this registration can be approved.');
        THROW 51563, @VerifyMsg, 1;
    END

    /* Mobile-number uniqueness guard, Charter only — a Turnover officer is always an
       EXISTING dbo.Member row (o.MemberId already resolved), never a freshly typed-in
       mobile number, so this can only ever matter for a Charter's brand-new officers.
       Dry-run decision: mobile number now doubles as an alternate sign-in identifier
       (usp_Auth_GetAccountForSignIn), so two members sharing one would make sign-in-by-
       mobile ambiguous. Checked here as the final gate before any Member row is created;
       same check repeated in usp_MembershipApplication_Approve and
       usp_Member_UpdateOwnProfile for the other two paths a Member row's MobileNo can
       come from. */
    IF @RegistrationType = 'Charter'
    BEGIN
        IF EXISTS (
            SELECT MobileNo FROM dbo.ChapterRegistrationOfficer
            WHERE RegistrationId = @RegistrationId AND MobileNo IS NOT NULL
            GROUP BY MobileNo HAVING COUNT(*) > 1
        )
            THROW 51565, 'Two or more officers on this registration share the same mobile number. Each officer needs his own — correct this before approving.', 1;

        IF EXISTS (
            SELECT 1 FROM dbo.ChapterRegistrationOfficer o
                 JOIN dbo.Member m ON m.MobileNo = o.MobileNo AND m.IsDeleted = 0
            WHERE o.RegistrationId = @RegistrationId
        )
            THROW 51566, 'One or more officers'' mobile numbers are already registered to an existing member. Each member needs his own — correct this before approving.', 1;
    END

    DECLARE @ApprovedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Approved');
    DECLARE @ActiveStatusId INT = (SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = 'Active');
    DECLARE @PlainMemberRoleId INT = (SELECT RoleId FROM dbo.Role WHERE RoleName = 'Member');

    BEGIN TRAN;

    IF @RegistrationType = 'Charter'
    BEGIN
        /* a. A chapter is never left without a parent (invariant #15), and its Region/
           Province/City council chain is built here rather than left to whatever
           usp_Council_ResolveJurisdiction found at SUBMISSION time — that lookup only
           ever picks the DEEPEST EXISTING match and never creates anything, so a chapter
           chartering the first-ever chapter in a brand-new city (or province, or region)
           would otherwise land one or more levels too high, and usp_Chapter_ListPublic's
           own geography walk (CityName/ProvinceName/RegionName) would then resolve NULL
           for it — invisible in the public sign-up picker until someone seeds the
           missing council by hand. This is that seeding, done automatically, in the same
           transaction as the chapter it justifies (invariant #13b: "a council requires
           at least one registered chapter in its jurisdiction before it can be created" —
           THIS chapter, being created a few statements below, is that chapter).

           Officers are DELIBERATELY NEVER auto-seated here — usp_Council_SeatOfficer
           needs a real, deliberate choice of who sits in each seat, same as any chapter's
           own registration; a level created this way starts dormant, exactly as if it had
           been seeded by hand (CLAUDE.md §13a: a dormant council still blocks nothing that
           can bootstrap-route to National). A DISSOLVED council (IsActive = 0, invariant
           #15 — reorganized jurisdictions keep their old row) is treated as "does not
           exist" for this walk, matching usp_Council_ResolveJurisdiction's own IsActive=1
           filter, so a fresh row is created for the current structure rather than
           resurrecting a dissolved one.

           CK_ChapterRegistration_Type (17_chapter_registration.sql) already guarantees a
           Charter row has RegionId/ProvinceId/MunicipalityId ALL set (never partially) —
           so the ELSE branch below is unreachable in practice, kept only as the same
           defence-in-depth this codebase applies elsewhere rather than assuming a CHECK
           constraint can never be relaxed later; it preserves this proc's original
           behaviour (fall back to whichever council actually acted) if that ever changes. */
        DECLARE @ParentCouncilId INT;

        IF @RegionId IS NOT NULL
        BEGIN
            DECLARE @AutoRegionName NVARCHAR(150) = (SELECT RegionName FROM dbo.Region WHERE RegionId = @RegionId);
            DECLARE @AutoProvinceName NVARCHAR(150) = (SELECT ProvinceName FROM dbo.Province WHERE ProvinceId = @ProvinceId);
            DECLARE @AutoMunicipalityName NVARCHAR(150) = (SELECT MunicipalityName FROM dbo.Municipality WHERE MunicipalityId = @MunicipalityId);
            DECLARE @NationalCouncilId INT = (
                SELECT c.CouncilId FROM dbo.Council c JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
                WHERE cl.LevelName = 'National' AND c.IsActive = 1);

            DECLARE @Walk INT = @NationalCouncilId;

            DECLARE @AutoRegionCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE RegionId = @RegionId AND IsActive = 1);
            IF @AutoRegionCouncilId IS NULL
            BEGIN
                INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, RegionId)
                SELECT @Walk, CouncilLevelId, @AutoRegionName + N' Council', @RegionId
                FROM   dbo.CouncilLevel WHERE LevelName = 'Regional';
                SET @AutoRegionCouncilId = SCOPE_IDENTITY();

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
                VALUES ('Council', CAST(@AutoRegionCouncilId AS NVARCHAR(40)), 'AutoCreate',
                        CONCAT(N'{"RegionId":', @RegionId, N',"RegistrationId":', @RegistrationId, N'}'), @RequestingMemberId);
            END
            SET @Walk = @AutoRegionCouncilId;

            DECLARE @AutoProvinceCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE ProvinceId = @ProvinceId AND IsActive = 1);
            IF @AutoProvinceCouncilId IS NULL
            BEGIN
                INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, ProvinceId)
                SELECT @Walk, CouncilLevelId, @AutoProvinceName + N' Council', @ProvinceId
                FROM   dbo.CouncilLevel WHERE LevelName = 'Provincial';
                SET @AutoProvinceCouncilId = SCOPE_IDENTITY();

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
                VALUES ('Council', CAST(@AutoProvinceCouncilId AS NVARCHAR(40)), 'AutoCreate',
                        CONCAT(N'{"ProvinceId":', @ProvinceId, N',"RegistrationId":', @RegistrationId, N'}'), @RequestingMemberId);
            END
            SET @Walk = @AutoProvinceCouncilId;

            DECLARE @AutoCityCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE MunicipalityId = @MunicipalityId AND IsActive = 1);
            IF @AutoCityCouncilId IS NULL
            BEGIN
                INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, MunicipalityId)
                SELECT @Walk, CouncilLevelId, @AutoMunicipalityName + N' Council', @MunicipalityId
                FROM   dbo.CouncilLevel WHERE LevelName = 'City/Municipal';
                SET @AutoCityCouncilId = SCOPE_IDENTITY();

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
                VALUES ('Council', CAST(@AutoCityCouncilId AS NVARCHAR(40)), 'AutoCreate',
                        CONCAT(N'{"MunicipalityId":', @MunicipalityId, N',"RegistrationId":', @RegistrationId, N'}'), @RequestingMemberId);
            END
            SET @Walk = @AutoCityCouncilId;

            SET @ParentCouncilId = @Walk;
        END
        ELSE
        BEGIN
            SET @ParentCouncilId =
                CASE WHEN @IntendedCouncilId IS NOT NULL
                          AND EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @IntendedCouncilId)
                     THEN @IntendedCouncilId ELSE @ActingCouncilId END;
        END

        /* f. CharteredUnderYear mirrors Akrho.Domain.MembershipYear.YearFor exactly:
           the membership year (09 Aug through 08 Aug, named by the year it opens) that
           TODAY falls in. Not a renewal record — see db/schema/17_chapter_registration.sql's
           header for why no RenewalPeriod/ChapterRenewal row is written here. */
        DECLARE @Anniversary DATE = DATEFROMPARTS(YEAR(@Today), 8, 8);
        DECLARE @CharteredUnderYear INT = CASE WHEN @Today > @Anniversary THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;

        /* b. Chapter number from the single NATIONAL sequence — never per-region. */
        DECLARE @ChapterSeqVal INT = NEXT VALUE FOR dbo.ChapterSeq;
        DECLARE @RegionCode CHAR(2) = (SELECT RegionCode FROM dbo.Region WHERE RegionId = @RegionId);
        DECLARE @Prefix NVARCHAR(12) = CONCAT('AKR-', @RegionCode, '-', RIGHT('0000' + CAST(@ChapterSeqVal AS NVARCHAR(10)), 4));

        INSERT dbo.Chapter (
            ParentCouncilId, ChapterName, Barangay, DateChartered,
            MarkAccentId, CharteredUnderYear, MemberNumberPrefix, NextMemberSeq)
        VALUES (
            @ParentCouncilId, @ProposedChapterName, @Barangay, @Today,
            @MarkAccentId, @CharteredUnderYear, @Prefix, 1);

        SET @ChapterId = SCOPE_IDENTITY();

        /* c./d. Each of the eight officers becomes a Member row plus TWO MemberRole
           rows — see db/schema/17_chapter_registration.sql's header comment on
           dbo.ChapterOffice for why two, not one: an open-ended plain 'Member' seat
           that never closes, and a dated office seat that turnover later closes.
           No LedgerEntry, no RenewalPeriod/ChapterRenewal row (g., forced correction —
           see this proc's own header and the schema file's). */
        DECLARE @PresidentMemberId INT;

        DECLARE officer_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT o.RegistrationOfficerId, o.OfficeId, co.OfficeName, co.RoleId,
                   o.FirstName, o.MiddleName, o.LastName, o.GiftName, o.BirthDate, o.MobileNo,
                   o.Email, o.DateSurvive, o.PresidentDuringSurvive, o.MasterInitiatorDuringSurvive
            FROM   dbo.ChapterRegistrationOfficer o
                   JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
            WHERE  o.RegistrationId = @RegistrationId
            ORDER BY co.SortOrder;

        DECLARE @OfficerRegOfficerId INT, @OfficeId INT, @OfficeName NVARCHAR(60), @OfficeRoleId INT,
                @OFirstName NVARCHAR(80), @OMiddleName NVARCHAR(80), @OLastName NVARCHAR(80), @OGiftName NVARCHAR(60),
                @OBirthDate DATE, @OMobileNo NVARCHAR(30), @OEmail NVARCHAR(150), @ODateSurvive DATE,
                @OPresidentDuringSurvive NVARCHAR(120), @OMasterInitiatorDuringSurvive NVARCHAR(120);

        OPEN officer_cursor;
        FETCH NEXT FROM officer_cursor INTO @OfficerRegOfficerId, @OfficeId, @OfficeName, @OfficeRoleId,
              @OFirstName, @OMiddleName, @OLastName, @OGiftName, @OBirthDate, @OMobileNo, @OEmail, @ODateSurvive,
              @OPresidentDuringSurvive, @OMasterInitiatorDuringSurvive;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @Seq INT, @MemberNumber NVARCHAR(30), @NewMemberId INT;

            /* Capture-and-increment in ONE statement — same race-safety pattern as
               usp_MembershipApplication_Approve's own header comment explains in full.
               Run once per officer, inside this same transaction, so eight officers
               never collide with a concurrent approval on some OTHER chapter (different
               row, different lock) nor with each other (same row, serialized). */
            UPDATE dbo.Chapter
               SET @Seq = NextMemberSeq, NextMemberSeq = NextMemberSeq + 1
             WHERE ChapterId = @ChapterId;

            SET @MemberNumber = CONCAT(@Prefix, '-', RIGHT('000' + CAST(@Seq AS NVARCHAR(10)), 3));

            INSERT dbo.Member (
                ChapterId, MemberNumber, FirstName, MiddleName, LastName, GiftName, Birthdate,
                MobileNo, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
                StatusId, RenewedThrough, ApprovedBy, ApprovedDate, IsDeleted)
            VALUES (
                @ChapterId, @MemberNumber, @OFirstName, @OMiddleName, @OLastName, @OGiftName, @OBirthDate,
                @OMobileNo, @OEmail, @ODateSurvive, @OPresidentDuringSurvive, @OMasterInitiatorDuringSurvive,
                @ActiveStatusId, NULL, @RequestingMemberId, SYSUTCDATETIME(), 0);

            SET @NewMemberId = SCOPE_IDENTITY();

            INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd, OfficeId)
            VALUES (@NewMemberId, @PlainMemberRoleId, 'Chapter', @ChapterId, @Today, NULL, NULL);

            INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd, OfficeId)
            VALUES (@NewMemberId, ISNULL(@OfficeRoleId, @PlainMemberRoleId), 'Chapter', @ChapterId, @Today, NULL, @OfficeId);

            UPDATE dbo.ChapterRegistrationOfficer SET CreatedMemberId = @NewMemberId WHERE RegistrationOfficerId = @OfficerRegOfficerId;

            IF @OfficeName = 'President' SET @PresidentMemberId = @NewMemberId;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('Member', CAST(@NewMemberId AS NVARCHAR(40)), 'Approve',
                    CONCAT(N'{"RegistrationId":', @RegistrationId, N',"OfficeId":', @OfficeId,
                           N',"MemberNumber":"', @MemberNumber, N'"}'), @RequestingMemberId);

            FETCH NEXT FROM officer_cursor INTO @OfficerRegOfficerId, @OfficeId, @OfficeName, @OfficeRoleId,
                  @OFirstName, @OMiddleName, @OLastName, @OGiftName, @OBirthDate, @OMobileNo, @OEmail, @ODateSurvive,
                  @OPresidentDuringSurvive, @OMasterInitiatorDuringSurvive;
        END
        CLOSE officer_cursor;
        DEALLOCATE officer_cursor;

        /* h. Enrolment link for the PRESIDENT ONLY — via INSERT...EXEC with OUTPUT
           params, exactly like usp_MembershipApplication_Approve. Every other officer
           (VP/Secretary/Treasurer/Auditor) and the three Master Initiators get NOTHING
           here; the President invites the rest from inside the app (§7A.4). This call
           requires this proc's task-15 companion change (usp_Enrolment_Issue's bounded
           council-issuer branch) only in the sense that @RequestingMemberId here is
           NOT yet seated anywhere on this brand-new chapter — he is a COUNCIL officer
           (CouncilAdmin, checked above) on an ANCESTOR of the chapter that was just
           created, which is exactly the bounded branch task 15 adds. */
        DECLARE @LinkId INT, @ExpiresOnOut DATETIME2;
        DECLARE @EnrolResult TABLE (LinkId INT, ExpiresOn DATETIME2);
        INSERT INTO @EnrolResult (LinkId, ExpiresOn)
        EXEC dbo.usp_Enrolment_Issue
            @MemberId = @PresidentMemberId, @IssuedBy = @RequestingMemberId,
            @TokenHash = @TokenHash, @ExpiresOn = @ExpiresOn,
            @LinkId = @LinkId OUTPUT, @ExpiresOnOut = @ExpiresOnOut OUTPUT,
            @DefaultPasswordHash = @DefaultPasswordHash;

        -- i. Decide the registration; record it; audit the chapter itself.
        UPDATE dbo.ChapterRegistration
           SET StatusId = @ApprovedId, IsOpen = 0, DecidedBy = @RequestingMemberId,
               DecidedDate = SYSUTCDATETIME(), CreatedChapterId = @ChapterId
         WHERE RegistrationId = @RegistrationId;

        INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
        VALUES (@RegistrationId, @RequestingMemberId, @ApprovedId,
                CONCAT(N'Approved. Chapter number ', @Prefix, N' assigned.'));

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Chapter', CAST(@ChapterId AS NVARCHAR(40)), 'Approve',
                CONCAT(N'{"RegistrationId":', @RegistrationId, N',"Prefix":"', @Prefix, N'"}'),
                @RequestingMemberId);

        SELECT @ChapterId AS ChapterId, @PresidentMemberId AS PresidentMemberId,
               @Prefix AS MemberNumberPrefix, @LinkId AS PresidentLinkId, @ExpiresOnOut AS PresidentLinkExpiresOn;
    END
    ELSE  -- Turnover
    BEGIN
        /* Close every CURRENTLY open office MemberRole row for this chapter —
           OfficeId IS NOT NULL only. The open-ended plain Member row is NEVER touched:
           "outgoing officers keep their member records and their history. Only the
           office ends" (§7A.4), expressed here as literally as SQL allows. */
        UPDATE mr
           SET TermEnd = @Today
        FROM   dbo.MemberRole mr
        WHERE  mr.ScopeType = 'Chapter' AND mr.ScopeId = @ChapterId
          AND  mr.OfficeId IS NOT NULL
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today);

        /* Seat every incoming officer, dated from today. Someone re-elected to the
           same office simply gets a fresh dated row alongside the one just closed —
           consistent with "terms are dated so permissions lapse automatically," even
           when the same man continues. */
        INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd, OfficeId)
        SELECT o.MemberId, ISNULL(co.RoleId, @PlainMemberRoleId), 'Chapter', @ChapterId, @Today, NULL, o.OfficeId
        FROM   dbo.ChapterRegistrationOfficer o
               JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
        WHERE  o.RegistrationId = @RegistrationId;

        /* Someone who already has an account keeps it — no link issued, no password
           touched — he simply gains the new office via the MemberRole insert above.
           Only a GrantsLogin office-holder with NO existing dbo.UserAccount row needs a
           brand-new enrolment link, and only if the caller supplied a token hash for him. */
        IF EXISTS (
            SELECT 1 FROM dbo.ChapterRegistrationOfficer o
                 JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
            WHERE o.RegistrationId = @RegistrationId AND co.GrantsLogin = 1
              AND NOT EXISTS (SELECT 1 FROM dbo.UserAccount ua WHERE ua.MemberId = o.MemberId)
              AND NOT EXISTS (SELECT 1 FROM @TurnoverTokenHashes t WHERE t.MemberId = o.MemberId)
        )
            THROW 51564, 'A token hash is required for every incoming officer who needs a brand-new account.', 1;

        DECLARE @ToEnrol TABLE (MemberId INT PRIMARY KEY, TokenHash VARBINARY(32));
        INSERT INTO @ToEnrol (MemberId, TokenHash)
        SELECT o.MemberId, t.TokenHash
        FROM   dbo.ChapterRegistrationOfficer o
               JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
               JOIN @TurnoverTokenHashes t ON t.MemberId = o.MemberId
        WHERE  o.RegistrationId = @RegistrationId
          AND  co.GrantsLogin = 1
          AND  NOT EXISTS (SELECT 1 FROM dbo.UserAccount ua WHERE ua.MemberId = o.MemberId);

        DECLARE @EnrolMemberId INT, @EnrolTokenHash VARBINARY(32);
        DECLARE @EnrolLinkId INT, @EnrolExpiresOnOut DATETIME2;
        DECLARE @IssuedLinks TABLE (MemberId INT, LinkId INT, ExpiresOn DATETIME2);

        DECLARE enrol_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT MemberId, TokenHash FROM @ToEnrol;
        OPEN enrol_cursor;
        FETCH NEXT FROM enrol_cursor INTO @EnrolMemberId, @EnrolTokenHash;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @EnrolResultTurnover TABLE (LinkId INT, ExpiresOn DATETIME2);
            DELETE FROM @EnrolResultTurnover;

            /* @IssuedBy = @SubmittedByMemberId — the OUTGOING chapter admin who FILED
               this turnover (usp_ChapterRegistration_SubmitTurnover requires the filer
               to hold ChapterAdmin at that moment), NOT @RequestingMemberId (the
               approving council's CouncilAdmin — a council officer with no chapter-scoped
               role on this chapter at all, so he could never satisfy usp_Enrolment_Issue's
               existing check). There is no council officer "present" at the exact instant
               a chapter needs its own officer enrolled — issuing is an internal step of
               THIS chapter's own transaction, on THIS chapter's own admin's authority, the
               same way a charter's brand-new President is enrolled by the chapter's own
               newly-assigned role rather than by whoever approved the charter.

               Does the outgoing admin still qualify? His office MemberRole row was closed
               by the UPDATE earlier in this SAME transaction with TermEnd = @Today —
               usp_Enrolment_Issue's own check is TermStart <= @Today AND (TermEnd IS NULL
               OR TermEnd >= @Today), and TermEnd = @Today still satisfies ">= @Today", so
               he reads as still-valid for TODAY under the same one-day-overlap logic this
               codebase already relies on elsewhere. This uses the EXISTING chapter-admin
               branch of usp_Enrolment_Issue unchanged — the new bounded council-issuer
               branch (task 15) is not needed here at all; it exists for the Charter branch
               above, where the issuer genuinely is a council officer with no prior chapter
               role to fall back on. */
            INSERT INTO @EnrolResultTurnover (LinkId, ExpiresOn)
            EXEC dbo.usp_Enrolment_Issue
                @MemberId = @EnrolMemberId, @IssuedBy = @SubmittedByMemberId,
                @TokenHash = @EnrolTokenHash, @ExpiresOn = @ExpiresOn,
                @LinkId = @EnrolLinkId OUTPUT, @ExpiresOnOut = @EnrolExpiresOnOut OUTPUT,
                @DefaultPasswordHash = @DefaultPasswordHash;

            INSERT INTO @IssuedLinks (MemberId, LinkId, ExpiresOn) VALUES (@EnrolMemberId, @EnrolLinkId, @EnrolExpiresOnOut);

            FETCH NEXT FROM enrol_cursor INTO @EnrolMemberId, @EnrolTokenHash;
        END
        CLOSE enrol_cursor;
        DEALLOCATE enrol_cursor;

        UPDATE dbo.ChapterRegistration
           SET StatusId = @ApprovedId, IsOpen = 0, DecidedBy = @RequestingMemberId, DecidedDate = SYSUTCDATETIME()
         WHERE RegistrationId = @RegistrationId;

        INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
        VALUES (@RegistrationId, @RequestingMemberId, @ApprovedId, N'Officer turnover approved.');

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('ChapterRegistration', CAST(@RegistrationId AS NVARCHAR(40)), 'Approve',
                CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId);

        SELECT @ChapterId AS ChapterId;
        SELECT MemberId, LinkId, ExpiresOn FROM @IssuedLinks;
    END

    COMMIT;
END
GO
