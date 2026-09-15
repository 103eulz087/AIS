/* One donation, in full. Any member of the donation's own chapter may read it — a member
   of a different chapter is rejected with the SAME "not found" message as a nonexistent
   id (anti-enumeration, same pattern as usp_Meeting_Get / usp_Expense_Get).

   Two result sets: the donation header, and its void history (if any — empty when live).
   No per-donor aggregation anywhere in this proc — see usp_Donation_GetByChapter's
   header comment; the same hard line applies here. */
CREATE OR ALTER PROCEDURE dbo.usp_Donation_Get
    @DonationId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChapterId INT;
    SELECT @ChapterId = ChapterId FROM dbo.Donation WHERE DonationId = @DonationId;

    IF @ChapterId IS NULL
        THROW 51211, 'Donation not found.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member
                   WHERE MemberId = @RequestingMemberId AND ChapterId = @ChapterId AND IsDeleted = 0)
        THROW 51211, 'Donation not found.', 1;

    -- 1. Header
    SELECT  d.DonationId, d.ChapterId, d.ActivityId, a.ActivityName, d.DonationDate,
            d.DonorName, d.DonorType, d.DonorTypeId, dt.TypeName, d.Subject, d.Body,
            d.Amount, d.InKindDescription, d.ChapterReceiptNo, d.RecordedBy,
            CAST(CASE WHEN v.DonationId IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS IsVoided
    FROM    dbo.Donation d
            LEFT JOIN dbo.Activity a ON a.ActivityId = d.ActivityId
            LEFT JOIN dbo.DonorType dt ON dt.DonorTypeId = d.DonorTypeId
            OUTER APPLY (SELECT TOP (1) DonationId FROM dbo.DonationVoid v WHERE v.DonationId = d.DonationId) v
    WHERE   d.DonationId = @DonationId;

    -- 2. Void history
    SELECT  dv.DonationVoidId, dv.VoidedBy, dv.VoidedDate, dv.Reason, dv.ReversedLedgerEntryId
    FROM    dbo.DonationVoid dv
    WHERE   dv.DonationId = @DonationId
    ORDER BY dv.VoidedDate ASC, dv.DonationVoidId ASC;
END
GO
