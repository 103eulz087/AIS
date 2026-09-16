/* The same form, filed again, against a chapter that already exists (§7A.4, "not a
   separate process"). Authenticated: @RequestingMemberId only — @ChapterId is ALWAYS
   re-derived server-side from his own currently-seated ChapterAdmin role (decision E1a;
   CLAUDE.md invariant #4 — never trust a chapterId the caller could supply). Officers
   are a TVP of (OfficeId, MemberId) pairs, never typed-in text — decision D: at
   turnover, every incoming officer is selected from that SAME chapter's existing member
   roster, because unlike a charter, people already exist here. */
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

    IF EXISTS (SELECT 1 FROM dbo.ChapterRegistration WHERE ChapterId = @ChapterId AND RegistrationType = 'Turnover' AND IsOpen = 1)
        THROW 51514, 'This chapter already has an officer-turnover form awaiting a decision.', 1;

    DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);

    DECLARE @RoutingResult TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
    INSERT INTO @RoutingResult (ActingCouncilId, CouncilName, IntendedCouncilId, RoutingReason)
    EXEC dbo.usp_Approval_ResolveApprover @ParentCouncilId = @ParentCouncilId;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    SELECT TOP (1) @ActingCouncilId = ActingCouncilId, @RoutingReason = RoutingReason FROM @RoutingResult;

    DECLARE @SubmittedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Submitted');
    DECLARE @RegistrationId INT, @ReferenceNo NVARCHAR(20);
    DECLARE @Year INT = YEAR(SYSUTCDATETIME());

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
           double-submit (e.g. a double-tapped submit button). */
        IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;

        SELECT TOP (1) @ReferenceNo = ReferenceNo
        FROM   dbo.ChapterRegistration
        WHERE  ChapterId = @ChapterId AND RegistrationType = 'Turnover' AND IsOpen = 1
        ORDER BY SubmittedDate DESC;
    END CATCH

    SELECT @ReferenceNo AS ReferenceNo;
END
GO
