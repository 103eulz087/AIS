/* Records that @RequestingMemberId has opened an announcement or memo. Idempotent:
   a second call for the same member+document is a silent no-op, not an error — the
   UI calls this on every open, it should never have to check "have I already marked
   this" first. dbo.ReadReceipt's own UQ_ReadReceipt (DocumentType, DocumentId,
   MemberId) is what makes that safe even under a race; the existence check below is
   just to avoid firing a needless INSERT (and possible constraint-violation error
   under concurrency) on the common repeat-open case.

   No AuditLog entry is written here, by design. AuditLog exists to answer "who
   changed what" for discipline- and money-relevant writes (CLAUDE.md §2 invariant
   #10); a read receipt is not a change to the record, it's a member reading it — the
   read-receipt trail (dbo.ReadReceipt itself, plus usp_Document_GetReadReceipts) IS
   the audit trail for this fact. Writing one AuditLog row per tap of every
   announcement/memo by every member would flood the log with rows nobody will ever
   query through it, since the real answer already lives in ReadReceipt. */
CREATE OR ALTER PROCEDURE dbo.usp_Document_MarkRead
    @DocumentType NVARCHAR(20),
    @DocumentId   INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @DocumentType NOT IN ('Announcement', 'Memo')
        THROW 51180, 'Unrecognized document type.', 1;

    DECLARE @ChapterId INT;

    IF @DocumentType = 'Announcement'
        SELECT @ChapterId = ScopeId FROM dbo.Announcement
        WHERE AnnouncementId = @DocumentId AND ScopeType = 'Chapter';
    ELSE
        SELECT @ChapterId = ScopeId FROM dbo.Memo
        WHERE MemoId = @DocumentId AND ScopeType = 'Chapter';

    IF @ChapterId IS NULL
        THROW 51181, 'Document not found.', 1;

    /* Scoping (invariant #4): a member may only mark read what his own chapter published. */
    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51181, 'Document not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.ReadReceipt
                   WHERE DocumentType = @DocumentType AND DocumentId = @DocumentId
                     AND MemberId = @RequestingMemberId)
        INSERT dbo.ReadReceipt (DocumentType, DocumentId, MemberId, ReadDate)
        VALUES (@DocumentType, @DocumentId, @RequestingMemberId, SYSUTCDATETIME());
END
GO
