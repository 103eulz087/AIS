/* Sets a member's notification preferences (upsert). No AuditLog write — a personal
   preference, same posture as usp_ChatParticipant_SetMute/MarkRead: nobody but the
   member himself ever needs to know he turned mention pings off.

   Race-safe upsert: UPDATE first, INSERT only if no row exists yet, with the INSERT's
   duplicate-key error (two tabs saving preferences for the same member at the same
   instant) folded back into the UPDATE — same shape as
   usp_ChatParticipant_MarkRead/SetMute. */
CREATE OR ALTER PROCEDURE dbo.usp_NotificationPreference_Set
    @MemberId INT,
    @PrivateMessagePush BIT,
    @MentionPush BIT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;
            UPDATE dbo.NotificationPreference
            SET    PrivateMessagePush = @PrivateMessagePush, MentionPush = @MentionPush, UpdatedOn = SYSUTCDATETIME()
            WHERE  MemberId = @MemberId;

            IF @@ROWCOUNT = 0
                INSERT dbo.NotificationPreference (MemberId, PrivateMessagePush, MentionPush)
                VALUES (@MemberId, @PrivateMessagePush, @MentionPush);
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;

        IF ERROR_NUMBER() IN (2601, 2627)
            UPDATE dbo.NotificationPreference
            SET    PrivateMessagePush = @PrivateMessagePush, MentionPush = @MentionPush, UpdatedOn = SYSUTCDATETIME()
            WHERE  MemberId = @MemberId;
        ELSE
            THROW;
    END CATCH
END
GO
