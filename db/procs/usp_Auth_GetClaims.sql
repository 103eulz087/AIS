/* Claims for the caller's own token: his chapter, his gift name, and his currently
   active role(s) only — a lapsed office grants nothing. Scoped to @MemberId alone,
   so this can never be used to read another member's roles. One row per active
   role; a member with no active role still returns one row with a NULL RoleName. */
CREATE OR ALTER PROCEDURE dbo.usp_Auth_GetClaims
    @MemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    SELECT m.MemberId, m.ChapterId, m.GiftName,
           r.RoleName, mr.ScopeType, mr.ScopeId
    FROM   dbo.Member m
           LEFT JOIN dbo.MemberRole mr
                  ON mr.MemberId = m.MemberId
                 AND mr.TermStart <= @Today
                 AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
           LEFT JOIN dbo.Role r ON r.RoleId = mr.RoleId
    WHERE  m.MemberId = @MemberId
      AND  m.IsDeleted = 0;
END
GO
