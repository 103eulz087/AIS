/* Paged donation list for a chapter. Any member of the chapter may read it. Shape
   matches usp_Expense_GetByChapter / usp_Meeting_GetByChapter: COUNT(*) OVER() for
   TotalCount, newest first.

   HARD LINE (CLAUDE.md invariant #5's texture, carried over from meeting contributions
   to donations): this proc NEVER aggregates by donor across rows. No "total given by
   this donor", no per-donor ranking, no parameter that would make one possible — that
   would recreate exactly the giving-leaderboard/shaming dynamic invariant #5 exists to
   prevent. Donations aggregate by activity (see usp_Activity_GetByChapter) and by
   chapter only. Do not add a donor-scoped filter or aggregate to this proc. */
CREATE OR ALTER PROCEDURE dbo.usp_Donation_GetByChapter
    @ChapterId INT,
    @RequestingMemberId INT,
    @Skip INT = 0,
    @Take INT = 50,
    @ActivityId INT = NULL,
    @FromDate   DATE = NULL,
    @ToDate     DATE = NULL,
    @IncludeVoided BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51210, 'Not permitted to read this chapter''s donations.', 1;

    SELECT  d.DonationId, d.ActivityId, a.ActivityName, d.DonationDate, d.DonorName,
            d.DonorType, d.DonorTypeId, dt.TypeName, d.Subject, d.Body, d.Amount,
            d.InKindDescription, d.ChapterReceiptNo, d.RecordedBy,
            CAST(CASE WHEN v.DonationId IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS IsVoided,
            COUNT(*) OVER() AS TotalCount
    FROM    dbo.Donation d
            LEFT JOIN dbo.Activity a ON a.ActivityId = d.ActivityId
            LEFT JOIN dbo.DonorType dt ON dt.DonorTypeId = d.DonorTypeId
            OUTER APPLY (SELECT TOP (1) DonationId FROM dbo.DonationVoid v WHERE v.DonationId = d.DonationId) v
    WHERE   d.ChapterId = @ChapterId
      AND   (@IncludeVoided = 1 OR v.DonationId IS NULL)
      AND   (@ActivityId IS NULL OR d.ActivityId = @ActivityId)
      AND   (@FromDate   IS NULL OR d.DonationDate >= @FromDate)
      AND   (@ToDate     IS NULL OR d.DonationDate <= @ToDate)
    ORDER BY d.DonationDate DESC, d.DonationId DESC
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
