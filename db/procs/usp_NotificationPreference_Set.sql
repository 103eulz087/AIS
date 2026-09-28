/* Sets a member's notification preferences (upsert). No AuditLog write — a personal
   preference, same posture as usp_ChatParticipant_SetMute/MarkRead: nobody but the
   member himself ever needs to know he turned mention pings (or National
   announcement pings) off.

   Race-safe upsert: UPDATE first, INSERT only if no row exists yet, with the INSERT's
   duplicate-key error (two tabs saving preferences for the same member at the same
   instant) folded back into the UPDATE — same shape as
   usp_ChatParticipant_MarkRead/SetMute. */
CREATE OR ALTER PROCEDURE dbo.usp_NotificationPreference_Set
    @MemberId INT,
    @PrivateMessagePush BIT,
    @MentionPush BIT,
    @AnnouncementPush BIT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;
            UPDATE dbo.NotificationPreference
            SET    PrivateMessagePush = @PrivateMessagePush, MentionPush = @MentionPush,
                   AnnouncementPush = @AnnouncementPush, UpdatedOn = SYSUTCDATETIME()
            WHERE  MemberId = @MemberId;

            IF @@ROWCOUNT = 0
                INSERT dbo.NotificationPreference (MemberId, PrivateMessagePush, MentionPush, AnnouncementPush)
                VALUES (@MemberId, @PrivateMessagePush, @MentionPush, @AnnouncementPush);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;

        IF ERROR_NUMBER() IN (2601, 2627)
            UPDATE dbo.NotificationPreference
            SET    PrivateMessagePush = @PrivateMessagePush, MentionPush = @MentionPush,
                   AnnouncementPush = @AnnouncementPush, UpdatedOn = SYSUTCDATETIME()
            WHERE  MemberId = @MemberId;
        ELSE
            THROW;
    END CATCH
END
GO
