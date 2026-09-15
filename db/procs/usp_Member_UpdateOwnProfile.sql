/* THE centerpiece of the self-service profile module. A member updates his own contact
   info, address, profession, blood type and skills — nothing organizational.

   =====================================================================================
   GUARDRAIL — READ BEFORE TOUCHING THE UPDATE STATEMENT BELOW.
   The SET list of the UPDATE dbo.Member statement in this procedure may EVER contain
   ONLY these six columns:
       MobileNo, Email, Address, BloodTypeId, BloodTypeConfirmedDate, Profession
   It must NEVER be extended to write any of: MemberNumber, FirstName, MiddleName,
   LastName, GiftName, Birthdate, DateSurvive, PresidentDuringSurvive,
   MasterInitiatorDuringSurvive, ChapterId, StatusId, RenewedThrough, SeconderMemberId,
   ApprovedBy, ApprovedDate, HomeCouncilId, IsDeleted. Those are organizational/historical
   facts (CLAUDE.md invariant #4/#11, docs §3.1) editable only by an officer, through a
   future module — never by the member himself, never from this procedure. If a future
   change to this file appears to require adding one of those columns to the SET list,
   STOP — that is a different module's job, not this one's.
   =====================================================================================

   NO @MemberId PARAMETER. Self-only by construction, same reasoning as
   usp_Member_GetOwnProfile — there is no id here for a caller to substitute.

   CONCURRENCY. @RowVersion is the value the client loaded with usp_Member_GetOwnProfile.
   The UPDATE's own WHERE clause carries the RowVersion match — that IS the concurrency
   guard, not a separate SELECT-then-compare (the same "check inside the statement, not
   before it" posture usp_MembershipApplication_Approve's NextMemberSeq capture uses for a
   different reason). @@ROWCOUNT = 0 after the UPDATE means the row moved since the client
   loaded it (MemberId = @RequestingMemberId itself can never mismatch, since the caller IS
   the row) — surfaced as a friendly "refresh and try again", never a raw concurrency
   exception.

   MOBILE NUMBER. Required, matching the "an officer/member with no number cannot be given
   access" rule already enforced elsewhere in this codebase (usp_Enrolment_Issue). It may
   never be blanked once set. A CHANGE (not merely a re-save of the same value) invalidates
   any outstanding, unredeemed enrolment link for this member — its MobileNoAtIssue snapshot
   is now stale, and a link built for a number the member no longer answers must not still
   work.

   BLOOD TYPE — STAMP-VS-LEAVE-ALONE LOGIC (docs §8: never shown as verified, always
   "self-reported, confirmed <date>"):
     - @BloodTypeId IS NULL            -> clear both BloodTypeId and BloodTypeConfirmedDate.
                                          There is no such thing as a confirmed date with no
                                          value to confirm.
     - @BloodTypeId differs from the value currently on the row (including NULL -> a value)
       OR @BloodTypeConfirmed = 1      -> stamp BloodTypeConfirmedDate = SYSUTCDATETIME().
                                          A changed value is, definitionally, a fresh
                                          self-report; an explicit re-confirm of an unchanged
                                          value is honoured too (the member re-affirming "yes,
                                          this is still right" is a legitimate, deliberate act,
                                          not a no-op).
     - @BloodTypeId is unchanged AND @BloodTypeConfirmed = 0
                                       -> BloodTypeConfirmedDate is left exactly as it was.
                                          Merely re-submitting the same value on an unrelated
                                          edit (say, just updating Address) must not silently
                                          refresh a confirmation the member did not actually
                                          re-affirm.

   SKILLS. @SkillIds is validated as a WHOLE before anything is written — every id must
   exist in dbo.Skill AND be IsActive = 1, or the entire call is rejected with no partial
   merge (the "check everything before the transaction opens" posture this codebase already
   uses elsewhere, e.g. usp_Expense_Create's attachment/category checks). Only after that
   passes does the MERGE run, scoped to a single member's rows so it costs an index seek,
   never a table scan (dbo.MemberSkill has no per-member row cap worth avoiding, but there is
   no reason to pay for one either).

   AUDIT. Two fields carry real consequences if wrong — MobileNo (how the enrolment link and
   account recovery reach him) and BloodTypeId (health information under RA 10173, docs §8)
   — so the audit row calls out old -> new for exactly those two, using AuditLog.OldValues /
   NewValues as a pair for the first time in this codebase (every earlier write proc has only
   ever populated NewValues; OldValues has sat unused on the table since 05_identity_renewal.sql
   until now). */
CREATE OR ALTER PROCEDURE dbo.usp_Member_UpdateOwnProfile
    @RequestingMemberId INT,
    @MobileNo           NVARCHAR(30),
    @Email              NVARCHAR(150) = NULL,
    @Address            NVARCHAR(250) = NULL,
    @BloodTypeId        INT           = NULL,
    @BloodTypeConfirmed BIT           = 0,
    @Profession         NVARCHAR(100) = NULL,
    @SkillIds           dbo.IntList READONLY,
    @RowVersion         BINARY(8)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @MobileNo IS NULL OR LTRIM(RTRIM(@MobileNo)) = ''
        THROW 51241, 'A mobile number is required. It cannot be blanked once set — it is how your account is reached and recovered.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0)
        THROW 51242, 'Member not found.', 1;

    DECLARE @OldMobileNo NVARCHAR(30), @OldBloodTypeId INT, @OldBloodTypeConfirmedDate DATETIME2;

    SELECT  @OldMobileNo = MobileNo,
            @OldBloodTypeId = BloodTypeId,
            @OldBloodTypeConfirmedDate = BloodTypeConfirmedDate
    FROM    dbo.Member
    WHERE   MemberId = @RequestingMemberId;

    IF @BloodTypeId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.BloodType WHERE BloodTypeId = @BloodTypeId)
        THROW 51243, 'That blood type is not on file. Choose one from the list.', 1;

    IF EXISTS (
        SELECT 1 FROM @SkillIds s
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Skill sk WHERE sk.SkillId = s.Value AND sk.IsActive = 1)
    )
        THROW 51244, 'One or more selected skills are not on the current list. Refresh and try again.', 1;

    -- Stamp-vs-leave-alone — see header comment.
    DECLARE @NewBloodTypeConfirmedDate DATETIME2;
    IF @BloodTypeId IS NULL
        SET @NewBloodTypeConfirmedDate = NULL;
    ELSE IF (@OldBloodTypeId IS NULL OR @OldBloodTypeId <> @BloodTypeId) OR @BloodTypeConfirmed = 1
        SET @NewBloodTypeConfirmedDate = SYSUTCDATETIME();
    ELSE
        SET @NewBloodTypeConfirmedDate = @OldBloodTypeConfirmedDate;

    DECLARE @NewRowVersion BINARY(8);
    DECLARE @NewRowVersionTable TABLE (RowVersion BINARY(8));

    BEGIN TRAN;
        -- The RowVersion match in the WHERE clause IS the concurrency guard.
        -- GUARDRAIL: this SET list may contain ONLY these six columns. See header comment.
        UPDATE dbo.Member
           SET MobileNo               = @MobileNo,
               Email                  = @Email,
               Address                = @Address,
               BloodTypeId            = @BloodTypeId,
               BloodTypeConfirmedDate = @NewBloodTypeConfirmedDate,
               Profession             = @Profession
        OUTPUT inserted.RowVersion INTO @NewRowVersionTable(RowVersion)
         WHERE MemberId  = @RequestingMemberId
           AND RowVersion = @RowVersion;

        IF @@ROWCOUNT = 0
            THROW 51245, 'This profile changed since you loaded it. Refresh and try again.', 1;

        SELECT @NewRowVersion = RowVersion FROM @NewRowVersionTable;

        -- Skill set: replace exactly, scoped to this member only (index seek, not a scan).
        -- MERGE's target must be a table, view, or CTE — a bare derived-table subquery is
        -- not valid syntax here, hence the CTE wrapper (still scoped to this member only,
        -- so WHEN NOT MATCHED BY SOURCE can never touch another member's rows).
        ;WITH CurrentSkills AS (
            SELECT MemberId, SkillId FROM dbo.MemberSkill WHERE MemberId = @RequestingMemberId
        )
        MERGE CurrentSkills AS tgt
        USING @SkillIds AS src
           ON tgt.SkillId = src.Value
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (MemberId, SkillId) VALUES (@RequestingMemberId, src.Value)
        WHEN NOT MATCHED BY SOURCE THEN
            DELETE;

        -- A mobile number CHANGE stales any outstanding enrolment link's MobileNoAtIssue
        -- snapshot for this member.
        IF (@OldMobileNo IS NULL OR @OldMobileNo <> @MobileNo)
        BEGIN
            UPDATE dbo.EnrolmentLink
               SET InvalidatedOn = SYSUTCDATETIME(),
                   InvalidatedReason = N'Mobile number changed'
             WHERE MemberId = @RequestingMemberId
               AND RedeemedOn IS NULL
               AND InvalidatedOn IS NULL;
        END

        INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
        VALUES ('Member', CAST(@RequestingMemberId AS NVARCHAR(40)), 'Update',
                CONCAT(N'{"MobileNo":"', @OldMobileNo, N'","BloodTypeId":',
                       ISNULL(CAST(@OldBloodTypeId AS NVARCHAR(20)), N'null'), N'}'),
                CONCAT(N'{"MobileNo":"', @MobileNo, N'","BloodTypeId":',
                       ISNULL(CAST(@BloodTypeId AS NVARCHAR(20)), N'null'), N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @NewRowVersion AS RowVersion;
END
GO
