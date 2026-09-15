/* Publishes a memo. There is no usp_Memo_Edit and there never will be — a memo is a
   document of record with a read-receipt trail; silently changing its body after
   people have read it would make that trail dishonest. A correction is a NEW memo
   that supersedes the old one via @SupersedesMemoId. The old row is never touched;
   see db/schema/08_comms_align.sql's header comment for why supersession is tracked
   by a join rather than a write-back column.

   @SupersedesMemoId, if given, MUST belong to the same chapter — cross-chapter
   supersession is rejected outright (invariant #4: a chapter's memo can only ever be
   corrected by that same chapter, never reached into from another one).

   MemoNumber is MEMO-<year>-<NNNN>, drawn from dbo.MemoSeq — a single, never-reset,
   never-reused sequence with the year glued on as a display prefix, matching this
   repo's existing RNW-/AR- numbering shape (see db/schema/08_comms_align.sql header
   comment for the padding-width reasoning). ScopeType/ScopeId are written as
   ('Chapter', @ChapterId) — chapter-authored only in this slice, per instruction;
   no council-cascade authoring path exists here or anywhere else yet. */
CREATE OR ALTER PROCEDURE dbo.usp_Memo_Publish
    @ChapterId INT,
    @RequestingMemberId INT,
    @Subject NVARCHAR(250),
    @Body    NVARCHAR(MAX),
    @SupersedesMemoId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

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
        THROW 51177, 'Only a chapter officer or chapter admin may publish a memo.', 1;

    IF @SupersedesMemoId IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM dbo.Memo
            WHERE MemoId = @SupersedesMemoId AND ScopeType = 'Chapter' AND ScopeId = @ChapterId
       )
        THROW 51178, 'The memo being superseded was not found in this chapter.', 1;

    DECLARE @MemoId INT, @MemoNumber NVARCHAR(30);

    BEGIN TRAN;
        SET @MemoNumber = CONCAT('MEMO-', YEAR(SYSUTCDATETIME()), '-',
            RIGHT('0000' + CAST(NEXT VALUE FOR dbo.MemoSeq AS NVARCHAR(10)), 4));

        INSERT dbo.Memo (MemoNumber, ScopeType, ScopeId, Title, Body, PublishDate,
                          CreatedBy, SupersedesMemoId)
        VALUES (@MemoNumber, 'Chapter', @ChapterId, @Subject, @Body, SYSUTCDATETIME(),
                @RequestingMemberId, @SupersedesMemoId);

        SET @MemoId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Memo', CAST(@MemoId AS NVARCHAR(40)), 'Publish',
                CONCAT(N'{"MemoNumber":"', @MemoNumber, N'","SupersedesMemoId":',
                       ISNULL(CAST(@SupersedesMemoId AS NVARCHAR(20)), N'null'), N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @MemoId AS MemoId, @MemoNumber AS MemoNumber;
END
GO
