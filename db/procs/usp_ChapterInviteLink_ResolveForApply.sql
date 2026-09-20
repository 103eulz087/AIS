/* Resolves a chapter invite link for the public, unauthenticated "join this chapter"
   landing page — the direct-link counterpart to usp_Chapter_ListPublic's cascading
   picker. Same anti-enumeration posture as usp_Credential_VerifyPublic/
   usp_Enrolment_Get: an unknown token, an invalidated one, and one whose chapter has
   since gone inactive all collapse to the IDENTICAL result shape (IsValid = 0, every
   other column NULL) — nothing here lets a caller learn WHICH of those it was.

   SCOPING EXCEPTION — DELIBERATE, same reasoning as usp_Credential_VerifyPublic's own
   header. @TokenHash IS the scope; there is no signed-in caller to scope against, and
   a token already resolves to exactly one chapter. Do not add a @RequestingMemberId
   or @ChapterId parameter to "fix" this.

   Returns ONLY ChapterId + ChapterName — enough for the landing page to say which
   chapter the applicant is joining and to submit
   POST /api/membership-applications with that ChapterId already fixed. Nothing about
   the chapter's council chain, roster, or finances belongs on a page reachable by
   anyone with the link. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterInviteLink_ResolveForApply
    @TokenHash VARBINARY(32)
AS
BEGIN
    SET NOCOUNT ON;

    -- IsValid keys off ch.ChapterId, the FINAL join target, on purpose — a live link
    -- row whose chapter has since gone inactive must read exactly like an unknown
    -- token, not like a valid one with a null name.
    SELECT  CAST(CASE WHEN ch.ChapterId IS NULL THEN 0 ELSE 1 END AS BIT) AS IsValid,
            ch.ChapterId,
            ch.ChapterName
    FROM    (SELECT @TokenHash AS TokenHash) x
            LEFT JOIN dbo.ChapterInviteLink cil
                   ON cil.TokenHash = x.TokenHash AND cil.InvalidatedOn IS NULL
            LEFT JOIN dbo.Chapter ch
                   ON ch.ChapterId = cil.ChapterId AND ch.IsActive = 1;
END
GO
