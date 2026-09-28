/* Every member a National announcement's push fan-out should reach — active,
   chapter-homed members only (mirrors usp_Credential_BulkIssueForExport's own
   @ChapterId = NULL case: a detached, council-homed member — invariant #14 — has no
   chapter AIS session this notification is about). Read-only, no permission check of
   its own: called immediately after usp_Announcement_CreateNational's own National-
   CouncilAdmin check has already succeeded, in the same authenticated request, and is
   never exposed as its own endpoint. */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_GetRecipientMemberIds
AS
BEGIN
    SET NOCOUNT ON;
    SELECT MemberId FROM dbo.Member WHERE IsDeleted = 0 AND ChapterId IS NOT NULL;
END
GO
