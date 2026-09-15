/* INTERNAL USE ONLY — called by the backend's push-dispatch worker to re-check a
   recipient's read state and mute preference for a room right before sending a push
   (enqueue, wait a short delay, re-check here, skip the push if the message has since
   been read or the room is muted), never by a user-reachable endpoint — same posture
   as usp_PushSubscription_GetForMember (db/procs/), which this session also built as
   internal-only. No @RequestingMemberId / permission check: the caller is trusted
   server-side infrastructure inspecting a specific (RoomId, MemberId) pair it already
   decided to look at, not a member-facing request that could be used to probe someone
   else's read state.

   dbo.ChatParticipant is read-state/preference storage only — see db/schema/14_chat.sql
   header comment #3 — so returning it here carries none of the scoping weight a chat
   content read would.

   No row yet is normal (a participant who has never marked anything read or muted
   anything in this room — e.g. a brand-new Private room, or a member who has simply
   never opened it). That is not "no data," it is the default state, so this always
   returns exactly one row: the natural defaults (NULL, 0) when there is no
   dbo.ChatParticipant row, so the worker never has to special-case an empty result set.

   Deliberately a single SELECT with a LEFT JOIN off a one-row constant, not an
   "IF @@ROWCOUNT = 0 SELECT ... defaults" fallback — a two-statement version emits
   TWO result sets when there is no row (the first SELECT's empty one, then the
   fallback's), and Dapper's QuerySingleOrDefaultAsync only ever reads the first
   result set. That shape would silently hand the caller null in exactly the "no row"
   case this proc exists to normalise. One SELECT, one result set, one row, always. */
CREATE OR ALTER PROCEDURE dbo.usp_ChatParticipant_GetState
    @RoomId   INT,
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT  cp.LastReadMessageId,
            IsMuted = ISNULL(cp.IsMuted, CAST(0 AS BIT))
    FROM    (SELECT 1 AS Dummy) AS d
            LEFT JOIN dbo.ChatParticipant cp
                ON cp.RoomId = @RoomId AND cp.MemberId = @MemberId;
END
GO
