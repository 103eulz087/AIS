/* Chapter mark, image slice. Self-scoped read behind GET /api/members/me/chapter-logo —
   ANY member (not just the President who set it) needs to see his own chapter's logo on
   his own Digital ID, so this takes no target id at all, same "no parameter to
   substitute" shape as usp_Member_GetOwnProfile. Detached, council-homed members
   (invariant #14) have no ChapterId and so never have a chapter logo — that's the same
   "no row" 51923 as a chapter that simply hasn't uploaded one yet; the caller (GetPhoto's
   own anti-enumeration posture) does not need to tell the two apart. */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_GetLogoForMember
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @LogoPath NVARCHAR(400), @ContentType NVARCHAR(100);
    SELECT  @LogoPath = ch.LogoPath, @ContentType = ch.LogoContentType
    FROM    dbo.Member m
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
    WHERE   m.MemberId = @RequestingMemberId AND m.IsDeleted = 0;

    IF @LogoPath IS NULL
        THROW 51923, 'No chapter logo on file.', 1;

    -- LogoContentType (added 2026-09-30): any image format is now accepted at upload
    -- (relaxed from PNG-only), so the actual stored content type must ride back with the
    -- path — the endpoint layer no longer assumes image/png.
    SELECT @LogoPath AS LogoPath, @ContentType AS LogoContentType;
END
GO
