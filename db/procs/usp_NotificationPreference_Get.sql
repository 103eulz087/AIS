/* Returns a member's notification preferences. Always returns EXACTLY ONE row, even
   for a member with no dbo.NotificationPreference row yet — the LEFT JOIN off a
   guaranteed single-row derived table, with ISNULL defaulting both flags to 1, means
   "no preference set yet" reads as "both enabled" rather than as an absent row the
   caller would otherwise have to special-case (see db/schema/15_chat_private.sql's
   header comment on this table: no row is ever pre-inserted for the whole membership
   just to carry default values). */
CREATE OR ALTER PROCEDURE dbo.usp_NotificationPreference_Get
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT  ISNULL(np.PrivateMessagePush, CAST(1 AS BIT)) AS PrivateMessagePush,
            ISNULL(np.MentionPush, CAST(1 AS BIT)) AS MentionPush
    FROM    (SELECT @MemberId AS MemberId) x
            LEFT JOIN dbo.NotificationPreference np ON np.MemberId = x.MemberId;
END
GO
