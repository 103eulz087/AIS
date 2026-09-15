/* Is this enrolment link valid, and whose is it? Not a login — the officer has no
   account yet. Always returns exactly one row so the caller can bind it directly;
   IsValid = 0 means expired, redeemed, invalidated, or the hash matched nothing. */
CREATE OR ALTER PROCEDURE dbo.usp_Enrolment_Get
    @TokenHash VARBINARY(32)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        CAST(CASE WHEN el.LinkId IS NULL THEN 0 ELSE 1 END AS BIT) AS IsValid,
        m.FirstName,
        m.GiftName,
        ch.ChapterName,
        el.ExpiresOn
    FROM (SELECT @TokenHash AS TokenHash) x
    LEFT JOIN dbo.EnrolmentLink el
           ON el.TokenHash = x.TokenHash
          AND el.RedeemedOn IS NULL
          AND el.InvalidatedOn IS NULL
          AND el.ExpiresOn > SYSUTCDATETIME()
    LEFT JOIN dbo.Member  m  ON m.MemberId = el.MemberId AND m.IsDeleted = 0
    LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId;
END
GO
