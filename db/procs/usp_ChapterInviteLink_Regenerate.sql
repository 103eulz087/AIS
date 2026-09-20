/* Issues (or replaces) the Chapter Admin's own chapter's invite link. Idempotent in
   effect but NOT in output: calling this again always produces a genuinely NEW token
   — there is no "give me the existing one back" path, because the raw value of an
   existing link was never stored anywhere to hand back (same SHOW-ONCE posture as
   usp_Enrolment_Issue). Calling it a second time is exactly how a Chapter Admin
   replaces a link he lost, or deliberately kills one that got shared somewhere he
   did not intend.

   NO @ChapterId PARAMETER — derived from the caller's own currently-seated
   ChapterAdmin role, identically to usp_ChapterInviteLink_GetOwn (CLAUDE.md
   invariant #4/#11).

   PERMANENT BY DECISION — no @ExpiresOn parameter, unlike usp_Enrolment_Issue. See
   18_chapter_invite_link.sql's own header for why this is deliberate, not an
   oversight.

   Invalidate-then-insert, in the SAME transaction, mirrors usp_Enrolment_Issue's own
   "supersede a stale row" comment and is what keeps
   UX_ChapterInviteLink_Chapter_Live correct — that filtered index cannot enforce
   "at most one live row" across two separate statements racing each other, only
   within one transaction acting on the row(s) already there. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterInviteLink_Regenerate
    @RequestingMemberId INT,
    @TokenHash          VARBINARY(32),
    @NewLinkId          INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

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

    BEGIN TRAN;
        UPDATE dbo.ChapterInviteLink
           SET InvalidatedOn = SYSUTCDATETIME(),
               InvalidatedBy = @RequestingMemberId
         WHERE ChapterId = @ChapterId
           AND InvalidatedOn IS NULL;

        INSERT dbo.ChapterInviteLink (ChapterId, TokenHash, CreatedBy)
        VALUES (@ChapterId, @TokenHash, @RequestingMemberId);

        SET @NewLinkId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('ChapterInviteLink', CAST(@NewLinkId AS NVARCHAR(40)), 'Regenerate',
                CONCAT(N'{"ChapterId":', @ChapterId, N'}'), @RequestingMemberId);
    COMMIT;

    SELECT @NewLinkId AS ChapterInviteLinkId;
END
GO
