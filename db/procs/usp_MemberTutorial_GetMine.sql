/* The tours a member has already finished or skipped, with the version he saw — so the web
   app knows whether to start one on sign-in (db/schema/31_member_tutorial.sql). A member
   only ever reads his own rows; @MemberId comes from his token, never the request. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberTutorial_GetMine
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT  mt.TourKey, mt.TourVersion, mt.Outcome, mt.FinishedDate
    FROM    dbo.MemberTutorial mt
            JOIN dbo.Tutorial t ON t.TourKey = mt.TourKey
    WHERE   mt.MemberId = @MemberId
      AND   t.IsActive = 1
    ORDER BY mt.TourKey;
END
GO
