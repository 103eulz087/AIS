/* Any member of the chapter reads this — deliberately NOT restricted by role.
   Reading is for everyone, including a Lapsed brother: Lapsed is not disciplinary
   (CLAUDE.md §7 vocabulary) and nothing in this module withholds information from him.

   Scoping (invariant #4): the caller must actually belong to @ChapterId. This is
   checked here, not assumed from an upstream token claim — same shape as
   usp_Ledger_GetByChapter's own check.

   @IncludeWithdrawn defaults to 0 (the ordinary member feed). An officer view that
   wants to see withdrawn announcements (e.g. to confirm a withdrawal went through,
   or to review "Withdrawn — <reason>" history) passes 1; that's a read, not a write,
   so it doesn't need its own role gate the way editing/withdrawing does — anyone in
   the chapter can already see a withdrawn card's reason if it's included, and the
   reason text carries no more sensitivity than the announcement body itself did.

   HasRead reflects @RequestingMemberId's OWN read receipt only — never another
   member's, which would leak who-read-what into a list endpoint that has no business
   answering that (that's what usp_Document_GetReadReceipts is for, and it is
   officer-gated). */
CREATE OR ALTER PROCEDURE dbo.usp_Announcement_GetForMember
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50,
    @IncludeWithdrawn BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51176, 'Not permitted to read this chapter''s announcements.', 1;

    -- a.UrgentType (the legacy free-text column) is deliberately NOT selected here: it's
    -- kept populated for backward compatibility by usp_Announcement_Create/_Edit, but
    -- ut.TypeName already gives the display-ready name from UrgentTypeId, and nothing in
    -- this API reads the free-text column — selecting it too only shifts every column
    -- after it out of position for the caller's row mapper.
    SELECT  a.AnnouncementId, a.Title, a.Body, a.IsUrgent, a.UrgentTypeId,
            ut.TypeName AS UrgentTypeName, a.BloodTypeId, bt.BloodTypeName,
            a.PublishDate, a.ExpiryDate, a.CreatedBy,
            a.EditedBy, a.EditedDate,
            a.IsWithdrawn, a.WithdrawnBy, a.WithdrawnDate, a.WithdrawnReason,
            CASE WHEN rr.ReadReceiptId IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS HasRead,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Announcement a
            LEFT JOIN dbo.UrgentType ut ON ut.UrgentTypeId = a.UrgentTypeId
            LEFT JOIN dbo.BloodType  bt ON bt.BloodTypeId  = a.BloodTypeId
            LEFT JOIN dbo.ReadReceipt rr
                   ON rr.DocumentType = 'Announcement'
                  AND rr.DocumentId   = a.AnnouncementId
                  AND rr.MemberId     = @RequestingMemberId
    WHERE   a.ScopeType = 'Chapter'
      AND   a.ScopeId   = @ChapterId
      AND   (@IncludeWithdrawn = 1 OR a.IsWithdrawn = 0)
    ORDER BY a.PublishDate DESC, a.AnnouncementId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
