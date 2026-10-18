/* Ticks ONE officer off against the sponsoring chapter's/council's own records — §7A.4:
   "Verification is per officer, not per form." Caller must hold the dynamic
   ChapterRegistration.Verify permission on the registration's ActingCouncilId
   (db/schema/28_council_permissions.sql's dbo.fn_MemberSeatPermissions) — a seat on that
   exact council whose office currently grants that key. Decision E1b's original fixed
   "CouncilSecretary or CouncilAdmin" matrix is still exactly what a council's default
   grid reproduces (see 28's own CouncilPermissionDefault seed); only ONE council's own
   President (via usp_CouncilPermission_Set) can now widen or narrow that from there —
   ONLY the President-equivalent default also grants the final approve in
   usp_ChapterRegistration_Approve, still the distinct, narrower capability.

   Mechanically cannot touch any roster field: the single UPDATE below names
   VerifiedBy / VerifiedDate / VerifyNote and nothing else. There is no second UPDATE
   anywhere in this proc, and no roster column (name, mobile, office, MemberId) is ever
   assigned here — a verifier confirms a roster; he cannot correct one. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_VerifyOfficer
    @RegistrationOfficerId INT,
    @RequestingMemberId INT,
    @Verified BIT,
    @Note NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @RegistrationId INT, @ActingCouncilId INT, @StatusId INT;

    SELECT  @RegistrationId = o.RegistrationId, @ActingCouncilId = cr.ActingCouncilId, @StatusId = cr.StatusId
    FROM    dbo.ChapterRegistrationOfficer o
            JOIN dbo.ChapterRegistration cr ON cr.RegistrationId = o.RegistrationId
    WHERE   o.RegistrationOfficerId = @RegistrationOfficerId;

    IF @RegistrationId IS NULL
        THROW 51540, 'Officer row not found.', 1;

    DECLARE @SubmittedId INT = (SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = 'Submitted');
    IF @StatusId <> @SubmittedId
        THROW 51541, 'This registration is not awaiting verification.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.fn_MemberSeatPermissions(@RequestingMemberId) sp
        WHERE  sp.CouncilId = @ActingCouncilId
          AND  sp.PermissionKey = N'ChapterRegistration.Verify'
    )
        THROW 51542, 'You do not have permission to verify officers for this council.', 1;

    BEGIN TRAN;
        UPDATE dbo.ChapterRegistrationOfficer
           SET VerifiedBy   = CASE WHEN @Verified = 1 THEN @RequestingMemberId ELSE NULL END,
               VerifiedDate = CASE WHEN @Verified = 1 THEN SYSUTCDATETIME() ELSE NULL END,
               VerifyNote   = @Note
         WHERE RegistrationOfficerId = @RegistrationOfficerId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('ChapterRegistrationOfficer', CAST(@RegistrationOfficerId AS NVARCHAR(40)),
                CASE WHEN @Verified = 1 THEN 'Verify' ELSE 'Unverify' END,
                CONCAT(N'{"RegistrationId":', @RegistrationId, N'}'), @RequestingMemberId);
    COMMIT;

    SELECT @RegistrationOfficerId AS RegistrationOfficerId, @Verified AS Verified;
END
GO
