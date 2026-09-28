/* Withdraws a National announcement — mirrors usp_Announcement_Withdraw exactly
   (soft-hide, mandatory 10-character reason, idempotent-safe against a double
   withdraw), narrowed to National Council Admin instead of a chapter officer/admin.
   Never a hard delete — same as every other withdraw in this codebase. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_WithdrawNational
    @AnnouncementId INT,
    @Reason NVARCHAR(400),
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51905, 'A reason of at least 10 characters is required — it will be shown to anyone who still has it open.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ScopeType NVARCHAR(20), @ScopeId INT, @IsWithdrawn BIT;

    SELECT @ScopeType = ScopeType, @ScopeId = ScopeId, @IsWithdrawn = IsWithdrawn
    FROM dbo.Announcement WHERE AnnouncementId = @AnnouncementId;

    IF @ScopeType IS NULL OR @ScopeType <> 'National'
        THROW 51903, 'Announcement not found.', 1;

    IF @IsWithdrawn = 1
        THROW 51904, 'This announcement has already been withdrawn.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @ScopeId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51902, 'Only the National Council Admin may withdraw this announcement.', 1;

    BEGIN TRAN;
        UPDATE dbo.Announcement
           SET IsWithdrawn     = 1,
               WithdrawnBy     = @RequestingMemberId,
               WithdrawnDate   = SYSUTCDATETIME(),
               WithdrawnReason = @Reason
         WHERE AnnouncementId = @AnnouncementId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Announcement', CAST(@AnnouncementId AS NVARCHAR(40)), 'WithdrawNational',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;

    SELECT @AnnouncementId AS AnnouncementId;
END
GO
