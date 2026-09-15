/* Digital ID module, slice 1. Anonymous photo lookup for the public verification page —
   the anti-forgery control the client confirmed as the module's intended largest
   anonymous-data-exposure decision (docs §4.10: "the photo is the primary control...
   look at the photo, then look at the person").

   SCOPING EXCEPTION — DELIBERATE. Same reasoning as usp_Credential_VerifyPublic's header
   comment, which applies identically here: @TokenSubject IS the scope. Do not add a
   @RequestingMemberId or @ChapterId parameter to "fix" this — there is no signed-in
   caller on the public page, and a token already resolves to exactly one member.

   This is a SEPARATE proc from usp_Member_GetPhoto (auth-required, same-chapter-scoped,
   keyed by MemberId — left completely untouched by this module) resolving through a
   credential token only, never through a MemberId a caller could supply directly. Reuses
   the identical storage mechanism usp_Member_GetPhoto already uses: dbo.Member.PhotoPath /
   PhotoContentType, the same file-storage-relative-path pattern IFileStorage resolves —
   nothing new is invented here.

   SAME "NOTHING TO SHOW" SIGNAL FOR EVERY NON-CASE. An unknown token, a revoked
   credential, an expired credential, a deleted member, AND a perfectly valid credential
   whose member simply has no photo on file all THROW the identical error — same posture
   as usp_Member_GetPhoto's own THROW for "not found" (see that proc's header comment).
   There is no branch anywhere in this proc that would let a caller tell "invalid token"
   apart from "valid token, no photo on file". */
CREATE OR ALTER PROCEDURE dbo.usp_Credential_GetPhotoForVerification
    @TokenSubject UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MemberId INT;

    SELECT  @MemberId = mc.MemberId
    FROM    dbo.MemberCredential mc
            JOIN dbo.Member m ON m.MemberId = mc.MemberId AND m.IsDeleted = 0
    WHERE   mc.TokenSubject = @TokenSubject
      AND   mc.RevokedDate IS NULL
      AND   mc.ExpiryDate  > SYSUTCDATETIME();

    IF @MemberId IS NULL
        THROW 51261, 'Photo not found.', 1;

    DECLARE @PhotoPath NVARCHAR(400), @ContentType NVARCHAR(100);
    SELECT  @PhotoPath = PhotoPath, @ContentType = PhotoContentType
    FROM    dbo.Member
    WHERE   MemberId = @MemberId;

    IF @PhotoPath IS NULL
        THROW 51261, 'Photo not found.', 1;

    SELECT @PhotoPath AS PhotoPath, @ContentType AS ContentType;
END
GO
