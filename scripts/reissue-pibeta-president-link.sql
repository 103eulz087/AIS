/* ============================================================================
   Re-issues the enrolment link for boy lungon (MemberId 849), founding President
   of "pi beta chapter" (ChapterId 150, ChapterRegistration 65) -- his original link
   never got redeemed (HasAccount = 0), most likely due to the staging IIS routing
   bug on /api/enrolment/{token} that's still being tracked down separately.

   Calls dbo.usp_Enrolment_Issue directly with @IssuedBy = 1 (TANGLAW, seated
   National Council Admin) -- this is the proc's own documented "Bounded Council
   Issuer" branch (see that proc's header comment), which exists specifically for a
   brand-new chapter's very first credential, before any Chapter Admin exists to
   reissue it himself. It only works because member 849 has no UserAccount yet and
   has never redeemed a link -- exactly this case.

   Generates the raw token the SAME way OpaqueToken.GenerateRaw()/Hash() do in C#
   (256 random bits, base64url-encoded; SHA-256 of the UTF8 bytes) so the resulting
   link is indistinguishable from one the app would have issued itself.

   Safe to re-run -- the proc itself invalidates any previous un-redeemed link for
   this member before issuing the new one (see its own "Invalidate any outstanding
   link" comment), so running this twice just supersedes the first result.
   ============================================================================ */
SET NOCOUNT ON;

DECLARE @MemberId INT = 849;   -- boy lungon, President, pi beta chapter
DECLARE @IssuedBy INT = 1;     -- TANGLAW, seated National Council Admin

DECLARE @randomBytes VARBINARY(32) = CRYPT_GEN_RANDOM(32);
DECLARE @base64 VARCHAR(MAX) = CAST(N'' AS XML).value('xs:base64Binary(sql:variable("@randomBytes"))', 'VARCHAR(MAX)');
DECLARE @rawToken VARCHAR(64) = REPLACE(REPLACE(REPLACE(@base64, '=', ''), '+', '-'), '/', '_');
DECLARE @tokenHash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(VARBINARY(MAX), @rawToken));

DECLARE @LinkId INT, @ExpiresOn DATETIME2;

EXEC dbo.usp_Enrolment_Issue
    @MemberId = @MemberId,
    @IssuedBy = @IssuedBy,
    @TokenHash = @tokenHash,
    @LinkId = @LinkId OUTPUT,
    @ExpiresOnOut = @ExpiresOn OUTPUT;

PRINT '--- New enrolment link issued ---';
PRINT 'LinkId: ' + CAST(@LinkId AS NVARCHAR(20));
PRINT 'Expires: ' + CONVERT(NVARCHAR(30), @ExpiresOn, 126) + ' UTC';
PRINT '';
PRINT 'Send this link (local dev -- staging''s enrolment route is not reliable yet):';
PRINT 'https://localhost:5173/enrol/' + @rawToken;
