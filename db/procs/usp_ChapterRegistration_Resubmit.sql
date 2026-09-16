/* A chapter-in-waiting corrects and resubmits a Charter registration the council sent
   back. There is still no account — @ReferenceNo + @MobileNo is the same "both must
   match" credential usp_ChapterRegistration_GetByReference uses, matched against the
   CURRENT (pre-correction) President's own mobile number, for the same reason that proc
   gives: the single combined lookup below cannot tell a caller whether the reference or
   the mobile was wrong, only that the pair together did not resolve to a row — one error,
   not two, so a wrong guess at either half teaches an attacker nothing.

   Turnover has NO equivalent of this proc — see usp_ChapterRegistration_SubmitTurnover's
   own header for why: it is already authenticated and chapter-scoped, so resubmission is
   just another call to that same proc, branching on the chapter's existing open row.

   Every field on the form may be corrected here, including the whole officer roster and
   the location (region/province/municipality, and therefore the jurisdiction the
   registration routes to) — a correction is not limited to typos in names. The roster is
   replaced wholesale (delete-and-reinsert), which clears every verification tick as a
   structural consequence: the old, ticked rows are gone, and the freshly inserted rows
   start unverified, exactly as they must once the roster the council checked no longer
   necessarily matches. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_Resubmit
    @ReferenceNo NVARCHAR(20),
    @MobileNo    NVARCHAR(30),
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
        THROW 51570, 'A proposed chapter name is required.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Municipality WHERE MunicipalityId = @MunicipalityId AND ProvinceId = @ProvinceId)
        THROW 51571, 'This municipality/city does not belong to the given province.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Province WHERE ProvinceId = @ProvinceId AND RegionId = @RegionId)
        THROW 51572, 'This province does not belong to the given region.', 1;

    IF @MarkAccentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.ChapterAccent WHERE AccentId = @MarkAccentId)
        THROW 51573, 'Unrecognized accent colour.', 1;

    DECLARE @OfficeCount INT = (SELECT COUNT(*) FROM dbo.ChapterOffice);

    IF (SELECT COUNT(*) FROM @Officers) <> @OfficeCount
        THROW 51574, 'Exactly one officer must be given for each of the eight chapter offices.', 1;

    IF EXISTS (SELECT 1 FROM dbo.ChapterOffice co LEFT JOIN @Officers o ON o.OfficeId = co.OfficeId WHERE o.OfficeId IS NULL)
        THROW 51574, 'Exactly one officer must be given for each of the eight chapter offices.', 1;

    IF EXISTS (SELECT 1 FROM @Officers o LEFT JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId WHERE co.OfficeId IS NULL)
        THROW 51575, 'Unrecognized office.', 1;

    IF EXISTS (SELECT 1 FROM @Officers WHERE LTRIM(RTRIM(ISNULL(MobileNo,''))) = '')
        THROW 51576, 'A mobile number is required for every officer — including the Master Initiators.', 1;

    IF EXISTS (SELECT 1 FROM @Officers WHERE BirthDate IS NULL OR BirthDate >= CAST(SYSUTCDATETIME() AS DATE))
        THROW 51577, 'Every officer''s birthdate must be a real date in the past.', 1;

    /* Same "both must match, one error either way" shape as usp_ChapterRegistration_GetByReference,
       keyed off the CURRENT (pre-correction) President's mobile — matched BEFORE the
       roster below replaces it. Charter officer rows are always typed-in free text
       (MemberId IS NULL, per CK_ChapterRegistrationOfficer_Person), so o.MobileNo is
       always the column to check here; there is no Member row to fall back to yet. */
    DECLARE @RegistrationId INT, @StatusId INT;
    SELECT  @RegistrationId = cr.RegistrationId, @StatusId = cr.StatusId
    FROM    dbo.ChapterRegistration cr
    WHERE   cr.ReferenceNo = @ReferenceNo
      AND   cr.RegistrationType = 'Charter'
      AND   EXISTS (
                SELECT 1
                FROM   dbo.ChapterRegistrationOfficer o
                       JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
                WHERE  o.RegistrationId = cr.RegistrationId
                  AND  co.OfficeName = 'President'
                  AND  o.MobileNo = @MobileNo
            );

    IF @RegistrationId IS NULL
        THROW 51578, 'Registration not found.', 1;

    DECLARE @ReturnedId  INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'ReturnedForCorrection');
    DECLARE @SubmittedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Submitted');

    IF @StatusId <> @ReturnedId
        THROW 51579, 'Only a registration returned for correction can be resubmitted.', 1;

    /* Re-resolve jurisdiction/routing — geography may have changed along with everything
       else on the form; a correction is not limited to typos. */
    DECLARE @JurisdictionResult TABLE (CouncilId INT);
    INSERT INTO @JurisdictionResult (CouncilId)
    EXEC dbo.usp_Council_ResolveJurisdiction @RegionId = @RegionId, @ProvinceId = @ProvinceId, @MunicipalityId = @MunicipalityId;

    DECLARE @IntendedCouncilId INT = (SELECT TOP (1) CouncilId FROM @JurisdictionResult);

    DECLARE @RoutingResult TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
    INSERT INTO @RoutingResult (ActingCouncilId, CouncilName, IntendedCouncilId, RoutingReason)
    EXEC dbo.usp_Approval_ResolveApprover @ParentCouncilId = @IntendedCouncilId;

    DECLARE @NewActingCouncilId INT, @NewRoutingReason NVARCHAR(40);
    SELECT TOP (1) @NewActingCouncilId = ActingCouncilId, @NewRoutingReason = RoutingReason FROM @RoutingResult;

    DECLARE @OldActingCouncilId INT = (SELECT ActingCouncilId FROM dbo.ChapterRegistration WHERE RegistrationId = @RegistrationId);

    BEGIN TRAN;
        UPDATE dbo.ChapterRegistration
           SET ProposedChapterName = @ProposedChapterName, Barangay = @Barangay,
               RegionId = @RegionId, ProvinceId = @ProvinceId, MunicipalityId = @MunicipalityId,
               MarkAccentId = @MarkAccentId,
               IntendedCouncilId = @IntendedCouncilId, ActingCouncilId = @NewActingCouncilId, RoutingReason = @NewRoutingReason,
               StatusId = @SubmittedId, IsOpen = 1
         WHERE RegistrationId = @RegistrationId;

        /* Replace the officer roster wholesale — see this proc's own header for why
           delete-and-reinsert is exactly what clears every verification tick. */
        DELETE FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @RegistrationId;

        INSERT dbo.ChapterRegistrationOfficer (
            RegistrationId, OfficeId, FirstName, MiddleName, LastName, GiftName, BirthDate,
            MobileNo, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive)
        SELECT @RegistrationId, o.OfficeId, o.FirstName, o.MiddleName, o.LastName, o.GiftName, o.BirthDate,
               o.MobileNo, o.Email, o.DateSurvive, o.PresidentDuringSurvive, o.MasterInitiatorDuringSurvive
        FROM   @Officers o;

        IF @NewActingCouncilId <> @OldActingCouncilId
            INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId)
            VALUES ('Chapter', @RegistrationId, @IntendedCouncilId, @NewActingCouncilId, @NewRoutingReason, NULL);

        /* UpdatedBy NULL — the applicant still has no account, same reasoning as
           usp_ChapterRegistration_Submit and usp_MembershipApplication_Resubmit. */
        INSERT dbo.ChapterRegistrationUpdate (RegistrationId, UpdatedBy, StatusId, Notes)
        VALUES (@RegistrationId, NULL, @SubmittedId, N'Resubmitted by the chapter after correction.');

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('ChapterRegistration', CAST(@RegistrationId AS NVARCHAR(40)), 'Resubmit', N'{}', NULL);
    COMMIT;

    SELECT @RegistrationId AS RegistrationId, @ReferenceNo AS ReferenceNo, @SubmittedId AS StatusId;
END
GO
