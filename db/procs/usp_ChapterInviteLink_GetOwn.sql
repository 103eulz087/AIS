/* A Chapter Admin checking his OWN chapter's current invite link, if he has one.
   Never returns the raw token (it was never stored — only its hash, shown once at
   creation/regeneration) — this is "does one exist, and since when", nothing more.

   NO @ChapterId PARAMETER. The chapter comes from the caller's own currently-seated
   ChapterAdmin role, never a value he could substitute (CLAUDE.md invariant #4/#11) —
   same derivation usp_ChapterInviteLink_Regenerate uses, so the two procs can never
   disagree about which chapter "his own" means. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterInviteLink_GetOwn
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @ChapterId INT = (
        SELECT TOP (1) mr.ScopeId
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId = @RequestingMemberId
          AND  mr.ScopeType = 'Chapter'
          AND  r.RoleName = 'ChapterAdmin'
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    );

    IF @ChapterId IS NULL
        THROW 51600, 'Only a chapter admin may manage an invite link.', 1;

    SELECT  CAST(CASE WHEN cil.ChapterInviteLinkId IS NULL THEN 0 ELSE 1 END AS BIT) AS HasLink,
            cil.CreatedDate
    FROM    (SELECT @ChapterId AS ChapterId) x
            LEFT JOIN dbo.ChapterInviteLink cil
                   ON cil.ChapterId = x.ChapterId AND cil.InvalidatedOn IS NULL;
END
GO
