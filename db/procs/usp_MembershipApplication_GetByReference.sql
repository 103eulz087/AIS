/* The unauthenticated "check my application" lookup. There is no account yet, so the
   only credential an applicant has is the reference number he was given plus the mobile
   number he applied with — BOTH must match, and a wrong reference is indistinguishable
   from a wrong mobile: either mismatch returns an EMPTY result set, never an error and
   never a partial row. The WHERE clause below enforces that by construction (a single
   equality on both columns), not by a branch that could be gotten wrong later. */
CREATE OR ALTER PROCEDURE dbo.usp_MembershipApplication_GetByReference
    @ReferenceNo NVARCHAR(20),
    @MobileNo    NVARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT  a.ApplicationId, a.ReferenceNo, a.ChapterId, ch.ChapterName,
            a.FirstName, a.MiddleName, a.LastName, a.GiftName, a.BirthDate,
            a.MobileNo, a.Email, a.DateSurvive,
            a.PresidentDuringSurvive, a.MasterInitiatorDuringSurvive,
            a.SeconderNameGiven, a.SeconderMemberNumberGiven,
            a.StatusId, s.StatusName, a.SubmittedDate, a.DecisionReason
    FROM    dbo.MembershipApplication a
            JOIN dbo.MembershipApplicationStatus s ON s.StatusId = a.StatusId
            JOIN dbo.Chapter ch ON ch.ChapterId = a.ChapterId
    WHERE   a.ReferenceNo = @ReferenceNo
      AND   a.MobileNo    = @MobileNo;
END
GO
