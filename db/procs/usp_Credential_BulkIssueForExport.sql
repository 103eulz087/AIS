/* Bulk equivalent of usp_Credential_GetOrIssueForSelf, for the National ID card export.
   Today a dbo.MemberCredential row is only ever minted lazily, one at a time, when a
   member opens his own Digital ID screen. A print run needs every member who WILL be on
   a card to already have a live credential first (the card's QR encodes TokenSubject),
   so this proc issues the missing ones up front, set-based, instead of forcing the
   export to wait on ~1,100 chapters' worth of members hitting their own screens first.

   IDEMPOTENCY RULE — mirrored EXACTLY from usp_Credential_GetOrIssueForSelf, not
   reinvented: a member already has a "currently valid" credential when a
   dbo.MemberCredential row exists for him with RevokedDate IS NULL AND ExpiryDate >
   SYSUTCDATETIME(). Only members with NO such row get a new one. A member who already has
   one keeps that same row (and that same TokenSubject) — this proc never issues a second,
   competing credential for someone already covered.

   SUPERSEDING STALE ROWS, SET-BASED. UX_MemberCredential_Member_Live allows at most one
   RevokedDate IS NULL row per member — so a member whose credential merely EXPIRED
   (never revoked) must have that stale row explicitly revoked before this proc's own
   INSERT can mint a replacement, or the insert would violate that index. Mirrors
   usp_Credential_GetOrIssueForSelf's own supersede step exactly, just as one set-based
   UPDATE covering every stale row in scope instead of a single-row branch.

   TokenSubject / PublicKeyVersion / IssuedDate: all left to their table defaults
   (NEWID(), 1, SYSUTCDATETIME()) — the exact same columns usp_Credential_GetOrIssueForSelf
   leaves untouched on its own INSERT. ExpiryDate: same "1 year from issuance if not
   supplied" convention, via the same @ExpiryDate = NULL optional parameter shape.

   PERMISSION — DUPLICATED, not trusted from the caller. Same National-CouncilAdmin check
   as usp_Member_ListForIdCardExport, independently re-verified here rather than assumed
   already done by whoever calls this proc (CLAUDE.md invariant #4 posture, applied to a
   write). See that proc's header for why ParentCouncilId IS NULL + CouncilLevel.LevelName
   = 'National' is used instead of a name match.

   SET-BASED, NOT A CURSOR. A single INSERT ... SELECT, scoped by @ChapterId exactly like
   the list proc (chapter-homed members only — see that proc's header for why detached,
   council-homed members are out of scope for a physical card run). The "does a live
   credential already exist" check runs under UPDLOCK/HOLDLOCK, the same locking posture
   usp_Credential_GetOrIssueForSelf uses for its own single-row check, so two overlapping
   bulk-issue calls (or a bulk call racing a member's own self-issue) cannot both decide
   "none exists" for the same member and each insert a row.

   AUDIT (invariant #10). One dbo.AuditLog row per NEWLY issued credential, written in the
   SAME transaction as the INSERT, via the INSERT's OUTPUT clause feeding a second
   set-based INSERT — no cursor, no per-row round trip. Same TableName/Action/NewValues
   shape as usp_Credential_GetOrIssueForSelf's own audit row, with "Source":"BulkExport"
   appended so an audit reader can tell a bulk-issued credential from a self-issued one. */
CREATE OR ALTER PROCEDURE dbo.usp_Credential_BulkIssueForExport
    @RequestingMemberId INT,
    @ChapterId           INT       = NULL,
    @ExpiryDate           DATETIME2 = NULL   -- defaults to 1 year from issuance if not supplied
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL
      AND  cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51580, 'The National Council is not configured. Seed it before running an ID card export.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51581, 'Only the National Council Admin may run an ID card export.', 1;

    IF @ExpiryDate IS NULL
        SET @ExpiryDate = DATEADD(YEAR, 1, SYSUTCDATETIME());

    DECLARE @Issued TABLE (CredentialId INT, MemberId INT, TokenSubject UNIQUEIDENTIFIER);

    BEGIN TRAN;
        -- Supersede stale (expired, never-revoked) rows for every member in scope FIRST —
        -- after this, RevokedDate IS NULL means "genuinely live" for the whole scope, which
        -- is what the INSERT's own NOT EXISTS below relies on.
        UPDATE mc
           SET RevokedDate = SYSUTCDATETIME(), RevokedBy = @RequestingMemberId
        FROM   dbo.MemberCredential mc WITH (UPDLOCK, HOLDLOCK)
               JOIN dbo.Member m ON m.MemberId = mc.MemberId
        WHERE  mc.RevokedDate IS NULL
          AND  mc.ExpiryDate  <= SYSUTCDATETIME()
          AND  m.IsDeleted = 0
          AND  m.ChapterId IS NOT NULL
          AND  (@ChapterId IS NULL OR m.ChapterId = @ChapterId);

        INSERT dbo.MemberCredential (MemberId, ExpiryDate)
        OUTPUT inserted.CredentialId, inserted.MemberId, inserted.TokenSubject INTO @Issued
        SELECT  m.MemberId, @ExpiryDate
        FROM    dbo.Member m
        WHERE   m.IsDeleted = 0
          AND   m.ChapterId IS NOT NULL
          AND   (@ChapterId IS NULL OR m.ChapterId = @ChapterId)
          AND   NOT EXISTS (
                    SELECT 1 FROM dbo.MemberCredential mc WITH (UPDLOCK, HOLDLOCK)
                    WHERE mc.MemberId    = m.MemberId
                      AND mc.RevokedDate IS NULL
                );

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        SELECT  'MemberCredential', CAST(CredentialId AS NVARCHAR(40)), 'Issue',
                CONCAT(N'{"MemberId":', MemberId,
                       N',"TokenSubject":"', TokenSubject, N'","Source":"BulkExport"}'),
                @RequestingMemberId
        FROM    @Issued;
    COMMIT;

    SELECT  COUNT(*) AS CredentialsIssued
    FROM    @Issued;
END
GO
