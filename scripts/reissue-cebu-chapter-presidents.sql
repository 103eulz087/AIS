/* ============================================================================
   Re-issues fresh enrolment links for the two other recently-approved Cebu-area
   chapter presidents whose original links were issued before the staging IIS
   routing bug on /api/enrolment/{token} was found -- clean slate rather than
   guessing whether their original links are still good.

     - KAPPA GAMMA CHAPTER (ChapterId 148): Lea, MemberId 833
     - ETA SIGMA           (ChapterId 149): Jun, MemberId 841

   Same mechanism as scripts/reissue-pibeta-president-link.sql: calls
   dbo.usp_Enrolment_Issue directly with @IssuedBy = 1 (TANGLAW, seated National
   Council Admin) -- the proc's own "Bounded Council Issuer" branch, since neither
   president has a UserAccount yet. Generates each raw token the same way
   OpaqueToken.GenerateRaw()/Hash() do in C#, so the resulting links are
   indistinguishable from ones the app would issue itself.

   Safe to re-run -- the proc invalidates each member's previous un-redeemed link
   before issuing the new one.
   ============================================================================ */
SET NOCOUNT ON;

DECLARE @IssuedBy INT = 1;   -- TANGLAW, seated National Council Admin

DECLARE @Members TABLE (MemberId INT PRIMARY KEY, Label NVARCHAR(100));
INSERT INTO @Members (MemberId, Label) VALUES
    (833, N'Lea -- President, KAPPA GAMMA CHAPTER'),
    (841, N'Jun -- President, ETA SIGMA');

DECLARE @MemberId INT, @Label NVARCHAR(100);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT MemberId, Label FROM @Members;
OPEN cur;
FETCH NEXT FROM cur INTO @MemberId, @Label;

WHILE @@FETCH_STATUS = 0
BEGIN
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

    PRINT '--- ' + @Label + ' ---';
    PRINT 'LinkId: ' + CAST(@LinkId AS NVARCHAR(20)) + '   Expires: ' + CONVERT(NVARCHAR(30), @ExpiresOn, 126) + ' UTC';
    PRINT 'https://localhost:5173/enrol/' + @rawToken;
    PRINT '';

    FETCH NEXT FROM cur INTO @MemberId, @Label;
END

CLOSE cur;
DEALLOCATE cur;
