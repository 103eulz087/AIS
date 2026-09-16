/* Ticks ONE officer off against the sponsoring chapter's/council's own records — §7A.4:
   "Verification is per officer, not per form." Caller must be seated CouncilSecretary OR
   CouncilAdmin on the registration's ActingCouncilId (decision E1b: both may verify;
   ONLY CouncilAdmin may give the final approval in usp_ChapterRegistration_Approve —
   that is the distinct, narrower capability).

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

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
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
        SELECT 1 FROM dbo.MemberRole mr
        JOIN   dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName IN ('CouncilSecretary', 'CouncilAdmin')
    )
        THROW 51542, 'Only this council''s Secretary or President may verify an officer on this registration.', 1;

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
