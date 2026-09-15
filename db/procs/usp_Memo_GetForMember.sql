/* Any member of the chapter reads this. Newest first, paged like
   usp_Announcement_GetForMember / usp_Ledger_GetByChapter.

   IsSuperseded / SupersededByMemoId / SupersededByMemoNumber are computed by a LEFT
   JOIN back onto dbo.Memo looking for a row whose SupersedesMemoId points at this
   one — no column is written onto the superseded memo itself. See
   db/schema/08_comms_align.sql's header comment for why: Memo has no update
   procedure at all (immutable once published), so a write-back here would be the
   only write ever made to a published memo, purely to cache a fact this join
   already gives for free at this system's scale (tens to low hundreds of members,
   a modest memo volume per chapter per year). */
CREATE OR ALTER PROCEDURE dbo.usp_Memo_GetForMember
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51179, 'Not permitted to read this chapter''s memos.', 1;

    SELECT  m.MemoId, m.MemoNumber, m.Title, m.Body, m.PublishDate, m.CreatedBy,
            m.SupersedesMemoId,
            CASE WHEN repl.MemoId IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS IsSuperseded,
            repl.MemoId     AS SupersededByMemoId,
            repl.MemoNumber AS SupersededByMemoNumber,
            CASE WHEN rr.ReadReceiptId IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS HasRead,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Memo m
            LEFT JOIN dbo.Memo repl ON repl.SupersedesMemoId = m.MemoId
            LEFT JOIN dbo.ReadReceipt rr
                   ON rr.DocumentType = 'Memo'
                  AND rr.DocumentId   = m.MemoId
                  AND rr.MemberId     = @RequestingMemberId
    WHERE   m.ScopeType = 'Chapter'
      AND   m.ScopeId   = @ChapterId
    ORDER BY m.PublishDate DESC, m.MemoId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
