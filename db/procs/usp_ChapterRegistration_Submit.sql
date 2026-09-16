/* Public, unauthenticated chapter charter application. No account exists yet for anyone
   named on it — @PerformedBy on the audit row and @ActorMemberId on the routing row are
   both NULL by design, exactly like usp_MembershipApplication_Submit before it.

   Validates: exactly the eight offices, each exactly once (dynamically checked against
   dbo.ChapterOffice's own row count — never a hardcoded "8" — see design note 2 in
   db/schema/10_membership_applications.sql for why this codebase resolves controlled
   lists by name/row-count rather than baking in a number that could silently drift from
   the seed); a mobile number for every officer, Master Initiators included (§7A.4: "An
   officer with no number cannot be given access" — true for all eight, even the three
   who receive no login, because they still become member records with their own
   MobileNo); and a real past birthdate for everyone.

   Double-submit handling is byte-for-byte the same idiom as
   usp_MembershipApplication_Submit: TRY/CATCH around the insert, and on a unique-index
   violation (2601/2627) — the one raised by UX_ChapterRegistration_OpenCharter — look up
   and hand back the ALREADY-open registration's own reference number instead of a raw
   error. A plain pre-check-then-insert would leave a race window between two truly
   concurrent submissions for the same (municipality, proposed name); catching the
   constraint violation itself does not. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_Submit
    @ProposedChapterName NVARCHAR(150),
    @Barangay            NVARCHAR(100) = NULL,
    @RegionId            INT,
    @ProvinceId          INT,
    @MunicipalityId      INT,
    @MarkAccentId        INT = NULL,
    @Officers            dbo.ChapterCharterOfficerRow READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @ProposedChapterName IS NULL OR LTRIM(RTRIM(@ProposedChapterName)) = ''
        THROW 51500, 'A proposed chapter name is required.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Municipality WHERE MunicipalityId = @MunicipalityId AND ProvinceId = @ProvinceId)
        THROW 51501, 'This municipality/city does not belong to the given province.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Province WHERE ProvinceId = @ProvinceId AND RegionId = @RegionId)
        THROW 51502, 'This province does not belong to the given region.', 1;

    IF @MarkAccentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.ChapterAccent WHERE AccentId = @MarkAccentId)
        THROW 51503, 'Unrecognized accent colour.', 1;

    DECLARE @OfficeCount INT = (SELECT COUNT(*) FROM dbo.ChapterOffice);

    IF (SELECT COUNT(*) FROM @Officers) <> @OfficeCount
        THROW 51504, 'Exactly one officer must be given for each of the eight chapter offices.', 1;

    IF EXISTS (SELECT 1 FROM dbo.ChapterOffice co LEFT JOIN @Officers o ON o.OfficeId = co.OfficeId WHERE o.OfficeId IS NULL)
        THROW 51504, 'Exactly one officer must be given for each of the eight chapter offices.', 1;

    IF EXISTS (SELECT 1 FROM @Officers o LEFT JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId WHERE co.OfficeId IS NULL)
        THROW 51505, 'Unrecognized office.', 1;

    IF EXISTS (SELECT 1 FROM @Officers WHERE LTRIM(RTRIM(ISNULL(MobileNo,''))) = '')
        THROW 51506, 'A mobile number is required for every officer — including the Master Initiators.', 1;

    IF EXISTS (SELECT 1 FROM @Officers WHERE BirthDate IS NULL OR BirthDate >= CAST(SYSUTCDATETIME() AS DATE))
        THROW 51507, 'Every officer''s birthdate must be a real date in the past.', 1;

    -- 1. Jurisdiction lookup, then routing (nearest existing ancestor with seated officers —
    --    normal operation, bootstrap, dormancy and delay are all this ONE rule; see
    --    usp_Approval_Routing.sql).
    DECLARE @JurisdictionResult TABLE (CouncilId INT);
    INSERT INTO @JurisdictionResult (CouncilId)
    EXEC dbo.usp_Council_ResolveJurisdiction @RegionId = @RegionId, @ProvinceId = @ProvinceId, @MunicipalityId = @MunicipalityId;

    DECLARE @IntendedCouncilId INT = (SELECT TOP (1) CouncilId FROM @JurisdictionResult);

    DECLARE @RoutingResult TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
    INSERT INTO @RoutingResult (ActingCouncilId, CouncilName, IntendedCouncilId, RoutingReason)
    EXEC dbo.usp_Approval_ResolveApprover @ParentCouncilId = @IntendedCouncilId;

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
                ReferenceNo, RegistrationType, ProposedChapterName, Barangay,
                RegionId, ProvinceId, MunicipalityId, MarkAccentId,
                IntendedCouncilId, ActingCouncilId, RoutingReason,
                SubmittedByMemberId, SubmittedDate, StatusId, IsOpen)
            VALUES (
                @ReferenceNo, 'Charter', @ProposedChapterName, @Barangay,
                @RegionId, @ProvinceId, @MunicipalityId, @MarkAccentId,
                @IntendedCouncilId, @ActingCouncilId, @RoutingReason,
                NULL, SYSUTCDATETIME(), @SubmittedId, 1);

            SET @RegistrationId = SCOPE_IDENTITY();

            INSERT dbo.ChapterRegistrationOfficer (
                RegistrationId, OfficeId, FirstName, MiddleName, LastName, GiftName, BirthDate,
                MobileNo, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive)
            SELECT @RegistrationId, o.OfficeId, o.FirstName, o.MiddleName, o.LastName, o.GiftName, o.BirthDate,
                   o.MobileNo, o.Email, o.DateSurvive, o.PresidentDuringSurvive, o.MasterInitiatorDuringSurvive
            FROM   @Officers o;

            INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId)
            VALUES ('Chapter', @RegistrationId, @IntendedCouncilId, @ActingCouncilId, @RoutingReason, NULL);

            INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
            VALUES (@RegistrationId, NULL, @SubmittedId, N'Submitted.');

            /* No authenticated actor exists yet — PerformedBy NULL is expected here, not a bug. */
            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('ChapterRegistration', CAST(@RegistrationId AS NVARCHAR(40)), 'Submit',
                    CONCAT(N'{"ProposedChapterName":"', REPLACE(@ProposedChapterName, '"', ''''),
                           N'","ReferenceNo":"', @ReferenceNo, N'"}'),
                    NULL);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;

        /* 2601/2627: unique-index violation — UX_ChapterRegistration_OpenCharter, on a
           genuine concurrent double-submit. Anything else is a real failure and must surface. */
        IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;

        SELECT TOP (1) @ReferenceNo = ReferenceNo
        FROM   dbo.ChapterRegistration
        WHERE  RegistrationType = 'Charter' AND IsOpen = 1
          AND  MunicipalityId = @MunicipalityId AND ProposedChapterName = @ProposedChapterName
        ORDER BY SubmittedDate DESC;
    END CATCH

    SELECT @ReferenceNo AS ReferenceNo;
END
GO
