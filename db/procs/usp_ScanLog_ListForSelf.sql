/* Digital ID module, slice A. The other half of the "two-way" scan log promised in
   dbo.ScanLog's own header comment (05_identity_renewal.sql): a member can see who
   verified his card and when, the same way usp_Credential_VerifyPublic and
   usp_Credential_VerifyForMember already record who did the verifying.

   SELF-ONLY BY CONSTRUCTION — same shape and same reasoning as
   usp_Credential_GetOrIssueForSelf / usp_Member_GetOwnProfile. @MemberId comes from
   the caller's own JWT-derived identity and IS whose log is returned; there is no
   parameter here a caller could substitute to read someone else's scan history, and
   none should ever be added.

   SCOPE OF A ROW. A row belongs to @MemberId when it was scanned against a
   dbo.MemberCredential that CredentialId points to and that credential's MemberId is
   @MemberId. A credential can be revoked or expired and its scan history still
   belongs to the member who owned it, so this deliberately does not filter on the
   credential's current live/dead state.

   INVARIANT #7 — THE SCANNER'S OWN IDENTITY IS SHOWN THE SAME WAY EVERYWHERE ELSE
   CROSS-CHAPTER DATA CROSSES A BOUNDARY. The member checking his own log is not
   necessarily from the same chapter as whoever scanned him, so the scanner is
   revealed only as ScannerGiftName + ScannerChapterName (LEFT JOIN — NULL for a scan
   with no ScannedByMemberId, i.e. an anonymous hit on the public verification page;
   rendering that NULL pair as "Not signed in" or similar is the DTO/frontend's job,
   not this proc's). ScannedByMemberId itself, and anything else about the scanner
   beyond gift name and chapter, is never returned.

   READ-ONLY, NO TRANSACTION NEEDED. Paged, newest first. */
CREATE OR ALTER PROCEDURE dbo.usp_ScanLog_ListForSelf
    @MemberId   INT,
    @PageSize   INT = 20,
    @PageNumber INT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF @PageSize IS NULL OR @PageSize < 1
        SET @PageSize = 20;
    IF @PageNumber IS NULL OR @PageNumber < 1
        SET @PageNumber = 1;

    SELECT  sl.ScanDate,
            sl.ResultCode,
            sl.WasOffline,
            scanner.GiftName    AS ScannerGiftName,
            scannerCh.ChapterName AS ScannerChapterName
    FROM    dbo.ScanLog sl
            JOIN dbo.MemberCredential mc ON mc.CredentialId = sl.CredentialId
            LEFT JOIN dbo.Member scanner    ON scanner.MemberId = sl.ScannedByMemberId
            LEFT JOIN dbo.Chapter scannerCh ON scannerCh.ChapterId = scanner.ChapterId
    WHERE   mc.MemberId = @MemberId
    ORDER BY sl.ScanDate DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS
    FETCH NEXT @PageSize ROWS ONLY;
END
GO
