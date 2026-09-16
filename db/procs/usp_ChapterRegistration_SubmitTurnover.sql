/* The same form, filed again, against a chapter that already exists (§7A.4, "not a
   separate process"). Authenticated: @RequestingMemberId only — @ChapterId is ALWAYS
   re-derived server-side from his own currently-seated ChapterAdmin role (decision E1a;
   CLAUDE.md invariant #4 — never trust a chapterId the caller could supply). Officers
   are a TVP of (OfficeId, MemberId) pairs, never typed-in text — decision D: at
   turnover, every incoming officer is selected from that SAME chapter's existing member
   roster, because unlike a charter, people already exist here.

   RESUBMISSION. Unlike a Charter (which has its own usp_ChapterRegistration_Resubmit,
   keyed by reference+mobile because no account exists yet), a Turnover is already
   authenticated and chapter-scoped — there is nothing a separate resubmit proc would add
   that this one cannot already derive from @RequestingMemberId. So this SAME proc
   branches on the chapter's existing open registration, if any:
     - none, or the existing one is already decided (IsOpen=0): normal INSERT path, as before.
     - ReturnedForCorrection (IsOpen=1): UPDATE it IN PLACE — a fresh INSERT would collide
       with UX_ChapterRegistration_OpenTurnover (one open Turnover row per chapter). The
       officer roster is replaced wholesale (delete-and-reinsert, which clears every
       verification tick as a structural consequence — the old, ticked rows are gone);
       routing is re-resolved (the chapter's ParentCouncilId may have changed since the
       original filing — invariant #15, reassignment); status resets to Submitted; the
       SAME ReferenceNo is returned, since nothing new was issued.
     - Submitted (IsOpen=1, not yet decided): a genuine conflict — THROW. There is no
       reference number to hand back that means anything to an already-authenticated
       caller (contrast usp_MembershipApplication_Submit's silent duplicate-return,
       which exists only because THAT caller has no other way to recover its own
       reference number). */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_SubmitTurnover
    @RequestingMemberId INT,
    @Officers dbo.ChapterTurnoverOfficerRow READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @ChapterId INT;
    SELECT TOP (1) @ChapterId = mr.ScopeId
    FROM   dbo.MemberRole mr
           JOIN dbo.Role   r ON r.RoleId = mr.RoleId
           JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
    WHERE  mr.MemberId  = @RequestingMemberId
      AND  mr.ScopeType = 'Chapter'
      AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
      AND  r.RoleName   = 'ChapterAdmin';

    IF @ChapterId IS NULL
        THROW 51510, 'Only a chapter''s own sitting Chapter Admin may file its officer turnover.', 1;

    DECLARE @OfficeCount INT = (SELECT COUNT(*) FROM dbo.ChapterOffice);

    IF (SELECT COUNT(*) FROM @Officers) <> @OfficeCount
        THROW 51511, 'Exactly one officer must be given for each of the eight chapter offices.', 1;

    IF EXISTS (SELECT 1 FROM dbo.ChapterOffice co LEFT JOIN @Officers o ON o.OfficeId = co.OfficeId WHERE o.OfficeId IS NULL)
        THROW 51511, 'Exactly one officer must be given for each of the eight chapter offices.', 1;

    IF EXISTS (SELECT 1 FROM @Officers o LEFT JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId WHERE co.OfficeId IS NULL)
        THROW 51512, 'Unrecognized office.', 1;

    /* Every incoming officer must already be a member of THIS chapter, in good standing.
       No typed-in new people at turnover — only at charter, where nobody exists yet. */
    IF EXISTS (
        SELECT 1 FROM @Officers o
        LEFT JOIN dbo.Member m ON m.MemberId = o.MemberId AND m.IsDeleted = 0 AND m.ChapterId = @ChapterId
        LEFT JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId AND ms.StatusName IN ('Approved','Active')
        WHERE m.MemberId IS NULL OR ms.StatusId IS NULL
    )
        THROW 51513, 'Every incoming officer must be an existing, approved or active member of this same chapter.', 1;

    DECLARE @SubmittedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Submitted');
    DECLARE @ReturnedId  INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'ReturnedForCorrection');

    DECLARE @ExistingOpenRegistrationId INT, @ExistingOpenStatusId INT;
    SELECT  @ExistingOpenRegistrationId = RegistrationId, @ExistingOpenStatusId = StatusId
    FROM    dbo.ChapterRegistration
    WHERE   ChapterId = @ChapterId AND RegistrationType = 'Turnover' AND IsOpen = 1;

    IF @ExistingOpenRegistrationId IS NOT NULL AND @ExistingOpenStatusId = @SubmittedId
        THROW 51514, 'This chapter already has an officer-turnover form awaiting a decision.', 1;

    DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);

    DECLARE @RoutingResult TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
    INSERT INTO @RoutingResult (ActingCouncilId, CouncilName, IntendedCouncilId, RoutingReason)
    EXEC dbo.usp_Approval_ResolveApprover @ParentCouncilId = @ParentCouncilId;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    SELECT TOP (1) @ActingCouncilId = ActingCouncilId, @RoutingReason = RoutingReason FROM @RoutingResult;

    DECLARE @RegistrationId INT, @ReferenceNo NVARCHAR(20);
    DECLARE @Year INT = YEAR(SYSUTCDATETIME());

    IF @ExistingOpenRegistrationId IS NOT NULL AND @ExistingOpenStatusId = @ReturnedId
    BEGIN
        SET @RegistrationId = @ExistingOpenRegistrationId;
        SELECT @ReferenceNo = ReferenceNo FROM dbo.ChapterRegistration WHERE RegistrationId = @RegistrationId;

        DECLARE @OldActingCouncilId INT = (SELECT ActingCouncilId FROM dbo.ChapterRegistration WHERE RegistrationId = @RegistrationId);

        BEGIN TRAN;
            UPDATE dbo.ChapterRegistration
               SET IntendedCouncilId = @ParentCouncilId, ActingCouncilId = @ActingCouncilId, RoutingReason = @RoutingReason,
                   SubmittedByMemberId = @RequestingMemberId, StatusId = @SubmittedId, IsOpen = 1
             WHERE RegistrationId = @RegistrationId;

            /* Replace the officer roster wholesale — delete-and-reinsert, every
               verification tick comes back cleared as a structural consequence (the OLD
               rows, ticks and all, are gone; the new rows are freshly inserted). */
            DELETE FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @RegistrationId;

            INSERT dbo.ChapterRegistrationOfficer (RegistrationId, OfficeId, MemberId)
            SELECT @RegistrationId, o.OfficeId, o.MemberId FROM @Officers o;

            IF @ActingCouncilId <> @OldActingCouncilId
                INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId)
                VALUES ('Chapter', @RegistrationId, @ParentCouncilId, @ActingCouncilId, @RoutingReason, @RequestingMemberId);

            INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
            VALUES (@RegistrationId, @RequestingMemberId, @SubmittedId, N'Resubmitted by the chapter admin after correction.');

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('ChapterRegistration', CAST(@RegistrationId AS NVARCHAR(40)), 'Resubmit',
                    CONCAT(N'{"ChapterId":', @ChapterId, N',"ReferenceNo":"', @ReferenceNo, N'"}'),
                    @RequestingMemberId);
        COMMIT;
    END
    ELSE
    BEGIN
        BEGIN TRY
            BEGIN TRAN;
                SET @ReferenceNo = CONCAT('CHR-', @Year, '-',
                    RIGHT('0000' + CAST(NEXT VALUE FOR dbo.ChapterRegistrationSeq AS NVARCHAR(10)), 4));

                INSERT dbo.ChapterRegistration (
                    ReferenceNo, RegistrationType, ChapterId,
                    IntendedCouncilId, ActingCouncilId, RoutingReason,
                    SubmittedByMemberId, SubmittedDate, StatusId, IsOpen)
                VALUES (
                    @ReferenceNo, 'Turnover', @ChapterId,
                    @ParentCouncilId, @ActingCouncilId, @RoutingReason,
                    @RequestingMemberId, SYSUTCDATETIME(), @SubmittedId, 1);

                SET @RegistrationId = SCOPE_IDENTITY();

                INSERT dbo.ChapterRegistrationOfficer (RegistrationId, OfficeId, MemberId)
                SELECT @RegistrationId, o.OfficeId, o.MemberId FROM @Officers o;

                INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId)
                VALUES ('Chapter', @RegistrationId, @ParentCouncilId, @ActingCouncilId, @RoutingReason, @RequestingMemberId);

                INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
                VALUES (@RegistrationId, @RequestingMemberId, @SubmittedId, N'Officer turnover filed.');

                INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
                VALUES ('ChapterRegistration', CAST(@RegistrationId AS NVARCHAR(40)), 'Submit',
                        CONCAT(N'{"ChapterId":', @ChapterId, N',"ReferenceNo":"', @ReferenceNo, N'"}'),
                        @RequestingMemberId);
            COMMIT;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK TRAN;

            /* 2601/2627: UX_ChapterRegistration_OpenTurnover, on a genuine concurrent
               double-submit (e.g. a double-tapped submit button) racing this same INSERT
               path — not the ReturnedForCorrection case above, which never reaches here. */
            IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;

            SELECT TOP (1) @ReferenceNo = ReferenceNo
            FROM   dbo.ChapterRegistration
            WHERE  ChapterId = @ChapterId AND RegistrationType = 'Turnover' AND IsOpen = 1
            ORDER BY SubmittedDate DESC;
        END CATCH
    END

    SELECT @ReferenceNo AS ReferenceNo;
END
GO
