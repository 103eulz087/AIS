/* Reference data — the controlled corrective-action category list (docs §4.5). Feeds the
   "file a case" form's category dropdown. No sensitivity here — the category NAMES are
   public regardless of who may see a given case's narrative (CLAUDE.md invariant #6 governs
   Content/ResolutionNotes/FiledBy, not this list). */
CREATE OR ALTER PROCEDURE dbo.usp_CorrectiveActionCategory_List
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CategoryId, CategoryName
    FROM   dbo.CorrectiveActionCategory
    ORDER BY CategoryName;
END
GO
