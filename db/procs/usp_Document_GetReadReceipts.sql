/* Officer tool: who has actually opened this announcement or memo. ChapterOfficer /
   ChapterAdmin only, and only for a document belonging to their own chapter —
   invariant #4 scoping is enforced here, not assumed from the caller having gotten
   this far in the UI. */
CREATE OR ALTER PROCEDURE dbo.usp_Document_GetReadReceipts
    @DocumentType NVARCHAR(20),
    @DocumentId   INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @DocumentType NOT IN ('Announcement', 'Memo')
        THROW 51182, 'Unrecognized document type.', 1;

    DECLARE @ChapterId INT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    IF @DocumentType = 'Announcement'
        SELECT @ChapterId = ScopeId FROM dbo.Announcement
        WHERE AnnouncementId = @DocumentId AND ScopeType = 'Chapter';
    ELSE
        SELECT @ChapterId = ScopeId FROM dbo.Memo
        WHERE MemoId = @DocumentId AND ScopeType = 'Chapter';

    IF @ChapterId IS NULL
        THROW 51182, 'Document not found.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM dbo.MemberRole mr
        JOIN dbo.Role   r ON r.RoleId = mr.RoleId
        JOIN dbo.Member m ON m.MemberId = mr.MemberId AND m.IsDeleted = 0
        WHERE mr.MemberId  = @RequestingMemberId
          AND mr.ScopeType = 'Chapter'
          AND mr.ScopeId   = @ChapterId
          AND mr.TermStart <= @Today
          AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND r.RoleName IN ('ChapterOfficer', 'ChapterAdmin')
    )
        THROW 51183, 'Only a chapter officer or chapter admin may see who has read this.', 1;

    SELECT  m.MemberId, m.GiftName, m.FirstName, m.LastName, rr.ReadDate
    FROM    dbo.ReadReceipt rr
            JOIN dbo.Member m ON m.MemberId = rr.MemberId
    WHERE   rr.DocumentType = @DocumentType
      AND   rr.DocumentId   = @DocumentId
    ORDER BY rr.ReadDate DESC;
END
GO
