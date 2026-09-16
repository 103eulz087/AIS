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
    @TurnoverTokenHashes dbo.MemberTokenHashRow READONLY
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

    DECLARE @OfficeCount INT = (SELECT COUNT(*) FROM dbo.ChapterOffice);
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

    DECLARE @ApprovedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Approved');
    DECLARE @ActiveStatusId INT = (SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = 'Active');
    DECLARE @PlainMemberRoleId INT = (SELECT RoleId FROM dbo.Role WHERE RoleName = 'Member');

    BEGIN TRAN;

    IF @RegistrationType = 'Charter'
    BEGIN
        /* a. A chapter is never left without a parent (invariant #15). Prefer the
           intended council if it now exists (it may have been created between
           submission and this approval — bootstrap is not instantaneous); otherwise
           fall back to whichever council actually acted. */
        DECLARE @ParentCouncilId INT =
            CASE WHEN @IntendedCouncilId IS NOT NULL
                      AND EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @IntendedCouncilId)
                 THEN @IntendedCouncilId ELSE @ActingCouncilId END;

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
            @LinkId = @LinkId OUTPUT, @ExpiresOnOut = @ExpiresOnOut OUTPUT;

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
                @LinkId = @EnrolLinkId OUTPUT, @ExpiresOnOut = @EnrolExpiresOnOut OUTPUT;

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
