/* Scoped photo read for GET /api/members/{id}/photo. Replaces the dangling
   `/api/files/{path}` concept (MembersEndpoints.cs currently emits a link nothing serves —
   every photo in the directory today is a broken image; that route must be DELETED, never
   implemented — a new endpoint calls this proc instead).

   Same visibility rule as the rest of the directory (usp_Member_Search's same-chapter
   branch, docs §4.2): a member may view a photo if he is the same member, OR a member of the
   same chapter. Cross-chapter search never carries a photo (CLAUDE.md invariant #7 — name,
   chapter, status only), so a cross-chapter request is refused here too, not just hidden by
   the client.

   SELF ACCESS DOES NOT GO THROUGH THE CHAPTER COMPARISON. A detached/council-attached member
   (invariant #14) has NULL ChapterId; comparing NULL = NULL is NULL (false) in T-SQL, which
   would incorrectly deny a detached member his own photo. Self access is therefore checked
   first and unconditionally, before any chapter lookup runs at all.

   ANTI-ENUMERATION, same posture as usp_Attachment_GetForDownload: a nonexistent member id,
   a wrong-chapter caller, AND a member who exists but has never uploaded a photo all return
   the identical "not found" — nothing here tells a prober which of the three is true. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_GetPhoto
    @MemberId           INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51247, 'Photo not found.', 1;

    IF @RequestingMemberId <> @MemberId
    BEGIN
        DECLARE @CallerChapterId INT, @TargetChapterId INT;

        SELECT @CallerChapterId = ChapterId FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0;
        SELECT @TargetChapterId = ChapterId FROM dbo.Member WHERE MemberId = @MemberId;

        IF @CallerChapterId IS NULL OR @TargetChapterId IS NULL OR @CallerChapterId <> @TargetChapterId
            THROW 51247, 'Photo not found.', 1;
    END

    DECLARE @PhotoPath NVARCHAR(400), @ContentType NVARCHAR(100);
    SELECT @PhotoPath = PhotoPath, @ContentType = PhotoContentType
    FROM   dbo.Member
    WHERE  MemberId = @MemberId;

    IF @PhotoPath IS NULL
        THROW 51247, 'Photo not found.', 1;

    SELECT @PhotoPath AS PhotoPath, @ContentType AS ContentType;
END
GO
