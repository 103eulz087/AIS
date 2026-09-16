/* The unauthenticated "check my registration" lookup — §7A.4: "that number plus the
   president's mobile is enough to check progress without an account." Same
   anti-enumeration shape as usp_MembershipApplication_GetByReference: a wrong reference
   and a wrong mobile are INDISTINGUISHABLE, both an empty result set, never an error and
   never a partial row — enforced by construction (the match is a single EXISTS against
   the President's own mobile number), not by a branch that could be gotten wrong later.

   Works for BOTH registration types. The President's mobile is always resolvable:
   Charter rows carry it as typed-in free text on the officer row itself (no account
   exists yet); Turnover rows carry it via the President seat's own dbo.Member row (an
   authenticated actor could also just use the authenticated queue/detail procs instead,
   but this stays reachable without login either way — filing status should never
   require a login to check).

   Returns status/dates/decision/acting-council name ONLY — NEVER the officer roster.
   The roster (names, mobiles, birthdates of seven other people) is not something a bare
   possession of a reference number and one phone number should unlock. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_GetByReference
    @ReferenceNo NVARCHAR(20),
    @MobileNo    NVARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT  cr.RegistrationId, cr.ReferenceNo, cr.RegistrationType,
            cr.ProposedChapterName, COALESCE(cr.ChapterId, cr.CreatedChapterId) AS ChapterId, ch.ChapterName,
            cr.StatusId, s.StatusName, cr.SubmittedDate,
            cr.DecidedDate, cr.DecisionReason,
            ac.CouncilId AS ActingCouncilId, ac.CouncilName AS ActingCouncilName
    FROM    dbo.ChapterRegistration cr
            JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
            JOIN dbo.Council ac ON ac.CouncilId = cr.ActingCouncilId
            /* Turnover rows carry the chapter on ChapterId from the start; a Charter row's
               ChapterId is NULL forever (it didn't exist at filing) and the chapter it
               eventually produced is CreatedChapterId instead — COALESCE covers both so a
               Charter's own status page can show its new chapter's name once approved. */
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = COALESCE(cr.ChapterId, cr.CreatedChapterId)
    WHERE   cr.ReferenceNo = @ReferenceNo
      AND   EXISTS (
                SELECT 1
                FROM   dbo.ChapterRegistrationOfficer o
                       JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
                WHERE  o.RegistrationId = cr.RegistrationId
                  AND  co.OfficeName = 'President'
                  AND  (
                            (o.MemberId IS NULL AND o.MobileNo = @MobileNo)
                         OR (o.MemberId IS NOT NULL AND EXISTS (
                                SELECT 1 FROM dbo.Member m
                                WHERE m.MemberId = o.MemberId AND m.MobileNo = @MobileNo))
                       )
            );
END
GO
