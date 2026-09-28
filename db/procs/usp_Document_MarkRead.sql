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
   query through it, since the real answer already lives in ReadReceipt.

   National scope (added 2026-09-27, Announcement only — dbo.Memo never gets a
   National row in this slice): there is no single chapter to check membership
   against, so the gate becomes "is this caller an active, chapter-homed member at
   all" — the same set usp_Announcement_GetRecipientMemberIds already broadcasts to.
   A detached, council-homed member (invariant #14) has no chapter AIS session this
   is relevant to, same reasoning as that procedure's own header comment. */
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

    DECLARE @ScopeType NVARCHAR(20), @ScopeId INT;

    IF @DocumentType = 'Announcement'
        SELECT @ScopeType = ScopeType, @ScopeId = ScopeId FROM dbo.Announcement WHERE AnnouncementId = @DocumentId;
    ELSE
        SELECT @ScopeType = ScopeType, @ScopeId = ScopeId FROM dbo.Memo WHERE MemoId = @DocumentId;

    IF @ScopeType IS NULL
        THROW 51181, 'Document not found.', 1;

    IF @ScopeType = 'Chapter'
    BEGIN
        /* Scoping (invariant #4): a member may only mark read what his own chapter published. */
        IF NOT EXISTS (SELECT 1 FROM dbo.Member
                       WHERE MemberId = @RequestingMemberId AND ChapterId = @ScopeId AND IsDeleted = 0)
            THROW 51181, 'Document not found.', 1;
    END
    ELSE IF @DocumentType = 'Announcement' AND @ScopeType = 'National'
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.Member
                       WHERE MemberId = @RequestingMemberId AND IsDeleted = 0 AND ChapterId IS NOT NULL)
            THROW 51181, 'Document not found.', 1;
    END
    ELSE
        THROW 51181, 'Document not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.ReadReceipt
                   WHERE DocumentType = @DocumentType AND DocumentId = @DocumentId
                     AND MemberId = @RequestingMemberId)
        INSERT dbo.ReadReceipt (DocumentType, DocumentId, MemberId, ReadDate)
        VALUES (@DocumentType, @DocumentId, @RequestingMemberId, SYSUTCDATETIME());
END
GO
