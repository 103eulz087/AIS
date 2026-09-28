/* INTERNAL — the push-dispatch worker's own use only, never a member-facing endpoint.
   Answers "has this member already opened this document in-app" so a National
   announcement push can be skipped the same way a chat push already is when the
   recipient beat the dispatch delay by reading it first (PushDispatchHostedService's
   own header comment) — the chat path checks usp_ChatParticipant_GetState instead,
   which has no equivalent for a document with no "room" at all. */
CREATE OR ALTER PROCEDURE dbo.usp_Document_HasRead
    @DocumentType NVARCHAR(20),
    @DocumentId   INT,
    @MemberId     INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(CASE WHEN EXISTS (
        SELECT 1 FROM dbo.ReadReceipt
        WHERE DocumentType = @DocumentType AND DocumentId = @DocumentId AND MemberId = @MemberId
    ) THEN 1 ELSE 0 END AS BIT) AS HasRead;
END
GO
