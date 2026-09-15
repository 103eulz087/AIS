/* Soft-hides an announcement with a mandatory reason. Never a hard delete — the row
   stays, IsWithdrawn flips to 1, and usp_Announcement_GetForMember's default view
   drops it from the feed while showing "Withdrawn — <reason>" to anyone who still
   has it open. Idempotent-safe: withdrawing an already-withdrawn announcement is
   rejected with a clear message rather than silently no-op'd, so an officer doesn't
   wonder whether a second click did anything.

   The 10-character floor on @Reason mirrors usp_Meeting_Reopen's own reason check —
   the same logic applies: this text is shown to the whole chapter, so "oops" is not
   an acceptable reason. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_Withdraw
    @AnnouncementId INT,
    @Reason NVARCHAR(400),
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason))) < 10
        THROW 51173, 'A reason of at least 10 characters is required — it will be shown to the whole chapter.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ScopeType NVARCHAR(20), @ChapterId INT, @IsWithdrawn BIT;

    SELECT @ScopeType = ScopeType, @ChapterId = ScopeId, @IsWithdrawn = IsWithdrawn
    FROM dbo.Announcement WHERE AnnouncementId = @AnnouncementId;

    IF @ChapterId IS NULL OR @ScopeType <> 'Chapter'
        THROW 51172, 'Announcement not found.', 1;

    IF @IsWithdrawn = 1
        THROW 51174, 'This announcement has already been withdrawn.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role   r ON r.RoleId = mr.RoleId
        JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName IN ('ChapterOfficer', 'ChapterAdmin')
    )
        THROW 51175, 'Only a chapter officer or chapter admin may withdraw this announcement.', 1;

    BEGIN TRAN;
        UPDATE dbo.Announcement
           SET IsWithdrawn     = 1,
               WithdrawnBy     = @RequestingMemberId,
               WithdrawnDate   = SYSUTCDATETIME(),
               WithdrawnReason = @Reason
         WHERE AnnouncementId = @AnnouncementId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Announcement', CAST(@AnnouncementId AS NVARCHAR(40)), 'Withdraw',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;

    SELECT @AnnouncementId AS AnnouncementId;
END
GO
