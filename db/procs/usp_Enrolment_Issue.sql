/* Issues a one-time, 72-hour enrolment link for a member who holds a role in the chapter —
   an officer at the time this was first written, and (since membership self-registration
   shipped) an ordinary newly-approved Member too. Never issues a password — see CLAUDE.md
   §2 invariant 16 / decision 18. The caller (backend) generates the raw token and its
   hash; this proc only ever sees the hash, and hands back the LinkId the caller needs to
   build the URL.

   @LinkId / @ExpiresOnOut OUTPUT let a caller already inside its own transaction (e.g.
   usp_MembershipApplication_Approve) capture the result directly, without an INSERT...EXEC
   workaround. The trailing SELECT below is UNCHANGED in shape so EnrolmentRepository (which
   reads it via Dapper) needs no change; it simply duplicates what the OUTPUT params now
   also carry.

   The @IssuedBy scope check below (THROW 51290) is what makes it safe to call this proc
   directly for an existing member who forgot his password (EnrolmentRepository.IssueAsync,
   used by the "resend enrolment link" endpoint) rather than only from
   usp_MembershipApplication_Approve. It re-validates cleanly for that existing caller too:
   @RequestingMemberId there was already confirmed ChapterAdmin of @ChapterId before the new
   member row (with that same ChapterId) was inserted in the same transaction, so the check
   below simply re-confirms what the caller already established. CLAUDE.md invariant #4: the
   chapter compared against is read from @MemberId's own row, never taken as a parameter.

   TWO acceptable issuers as of the chapter-registration module (decision A), OR'd together:

   1. CHAPTER ADMIN of @MemberId's own chapter — the ORIGINAL branch above, UNCHANGED in
      effect. Same predicate, same THROW, same everything a caller could observe. This
      remains the path for "resend a link," "approve an ordinary sign-up," and
      usp_ChapterRegistration_Approve's own Turnover branch (the outgoing chapter admin,
      whose office row that same transaction just closed with TermEnd = today, still
      reads as valid for today — see that proc's own comment for why).

   2. BOUNDED COUNCIL ISSUER (new) — a council officer holding a currently-seated
      Council-scoped role on an ANCESTOR council of @MemberId's own chapter (walked UP via
      Chapter.ParentCouncilId, then Council.ParentCouncilId — never a parameter), but ONLY
      when @MemberId has NO dbo.UserAccount row yet AND has never redeemed an EnrolmentLink.
      Why this branch has to exist at all: usp_ChapterRegistration_Approve's CHARTER branch
      creates a chapter's very first President and must hand him his first enrolment link —
      but nobody has EVER been that chapter's admin yet (the President being enrolled IS
      what creates one), so branch 1 can never fire for a charter. The approving actor there
      is necessarily a COUNCIL officer instead.
      Why it is bounded to FIRST-CREDENTIAL-ONLY, never a re-issue path: without the
      no-account-yet / never-redeemed guard, this would quietly become "any council officer
      may manage the login of any member anywhere beneath it, forever" — a standing power no
      council is meant to hold over a chapter's own accounts (§7A.4's whole officer-roster
      model is chapter-administered). Once a member has an account, or has ever redeemed a
      link, this branch permanently stops applying to him; only his own chapter's admin may
      touch his enrolment from then on, via branch 1. */
CREATE OR ALTER PROCEDURE dbo.usp_Enrolment_Issue
    @MemberId  INT,
    @IssuedBy  INT,
    @TokenHash VARBINARY(32),
    @ExpiresOn DATETIME2 = NULL,     -- defaults to 72 hours from now
    @LinkId    INT = NULL OUTPUT,
    @ExpiresOnOut DATETIME2 = NULL OUTPUT,
    -- DRY-RUN ONLY (see Akrho.Infrastructure.Security.DryRunDefaults). NULL (the default)
    -- preserves the original behaviour exactly: no account touched, the link is the only
    -- way in. A caller that passes a hash here also gets the member signed-in-capable
    -- immediately, on THIS hash, without waiting for the link to be redeemed — the link
    -- keeps working unchanged and still lets him set his own password whenever he does
    -- use it (usp_Enrolment_Redeem's existing "account already exists" branch).
    @DefaultPasswordHash NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @MobileNo NVARCHAR(30), @ChapterId INT;
    SELECT @MobileNo = MobileNo, @ChapterId = ChapterId
    FROM   dbo.Member
    WHERE  MemberId = @MemberId AND IsDeleted = 0;

    IF @MobileNo IS NULL
        THROW 51100, 'Member not found, or has no mobile number on file. A member with no number cannot be given access.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    /* Branch 1 — chapter admin of @MemberId's own chapter. Byte-identical predicate to
       before this file was amended for the chapter-registration module. */
    DECLARE @IsChapterAdmin BIT = CASE WHEN EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
        JOIN   dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @IssuedBy
          AND  mr.ScopeType = 'Chapter'
          AND  mr.ScopeId   = @ChapterId
          AND  mr.TermStart <= @Today
          AND  (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName   = 'ChapterAdmin'
    ) THEN 1 ELSE 0 END;

    /* Branch 2 — bounded council issuer, first-credential-only. Only evaluated once
       branch 1 has already failed, so the ordinary "chapter admin issuing for his own
       chapter" path never pays for an ancestor walk it doesn't need. */
    DECLARE @IsBoundedCouncilIssuer BIT = 0;
    IF @IsChapterAdmin = 0
    BEGIN
        DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);

        DECLARE @AncestorCouncils TABLE (CouncilId INT PRIMARY KEY);
        ;WITH AncestorTree AS (
            SELECT CouncilId, ParentCouncilId FROM dbo.Council WHERE CouncilId = @ParentCouncilId
            UNION ALL
            SELECT c.CouncilId, c.ParentCouncilId
            FROM   dbo.Council c JOIN AncestorTree a ON c.CouncilId = a.ParentCouncilId
        )
        INSERT INTO @AncestorCouncils (CouncilId)
        SELECT CouncilId FROM AncestorTree
        OPTION (MAXRECURSION 20);

        IF EXISTS (
            SELECT 1
            FROM   dbo.MemberRole mr
            JOIN   dbo.Role r ON r.RoleId = mr.RoleId
            WHERE  mr.MemberId  = @IssuedBy
              AND  mr.ScopeType = 'Council'
              AND  mr.ScopeId  IN (SELECT CouncilId FROM @AncestorCouncils)
              AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
              AND  r.IsCouncilRole = 1
        )
        AND NOT EXISTS (SELECT 1 FROM dbo.UserAccount ua WHERE ua.MemberId = @MemberId)
        AND NOT EXISTS (SELECT 1 FROM dbo.EnrolmentLink el WHERE el.MemberId = @MemberId AND el.RedeemedOn IS NOT NULL)
            SET @IsBoundedCouncilIssuer = 1;
    END

    IF @IsChapterAdmin = 0 AND @IsBoundedCouncilIssuer = 0
        THROW 51290, 'Only this chapter''s admin, or — for a member''s very first credential only — a council officer over this chapter''s jurisdiction, may issue an enrolment link for one of its members.', 1;

    /* Deliberately ANY currently-active role, not a specific one — this is what lets a
       plain, newly-approved Member and a seated officer share this same proc with no
       branch between them. Do not narrow this to officer roles; that would break
       usp_MembershipApplication_Approve, which relies on exactly this check accepting
       the ordinary 'Member' role it assigns immediately beforehand, in the same
       transaction. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole
        WHERE  MemberId = @MemberId
          AND  TermStart <= @Today
          AND  (TermEnd IS NULL OR TermEnd >= @Today)
    )
        THROW 51101, 'Member does not currently hold any role in this chapter. Approval must assign a role before an enrolment link can be issued.', 1;

    IF @ExpiresOn IS NULL SET @ExpiresOn = DATEADD(HOUR, 72, SYSUTCDATETIME());

    DECLARE @NewLinkId INT;

    BEGIN TRAN;
        /* Invalidate any outstanding link for this member before issuing a new one —
           there is never more than one live link per officer. */
        UPDATE dbo.EnrolmentLink
           SET InvalidatedOn = SYSUTCDATETIME(),
               InvalidatedReason = N'Superseded by a new enrolment link'
         WHERE MemberId = @MemberId
           AND RedeemedOn IS NULL
           AND InvalidatedOn IS NULL;

        INSERT dbo.EnrolmentLink (MemberId, TokenHash, MobileNoAtIssue, IssuedBy, ExpiresOn)
        VALUES (@MemberId, @TokenHash, @MobileNo, @IssuedBy, @ExpiresOn);

        SET @NewLinkId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('EnrolmentLink', CAST(@NewLinkId AS NVARCHAR(40)), 'Issue',
                CONCAT(N'{"MemberId":', @MemberId, N',"ExpiresOn":"',
                       CONVERT(NVARCHAR(30), @ExpiresOn, 126), N'"}'),
                @IssuedBy);

        /* DRY-RUN ONLY. Mirrors usp_Enrolment_Redeem's own create-or-update-account logic
           exactly, so a member who later DOES redeem this link lands on that same,
           already-familiar code path (his own chosen password simply overwrites this one).
           Never fired when @DefaultPasswordHash is NULL — the original, hardened behaviour. */
        IF @DefaultPasswordHash IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.UserAccount WHERE MemberId = @MemberId)
                UPDATE dbo.UserAccount
                   SET PasswordHash      = @DefaultPasswordHash,
                       PasswordUpdatedOn = SYSUTCDATETIME(),
                       FailedAttempts    = 0,
                       LockedUntil       = NULL,
                       IsDisabled        = 0
                 WHERE MemberId = @MemberId;
            ELSE
                INSERT dbo.UserAccount (MemberId, PasswordHash, PasswordUpdatedOn)
                VALUES (@MemberId, @DefaultPasswordHash, SYSUTCDATETIME());

            -- [Action] is NVARCHAR(20) — 'DryRunDefaultPasswordSet' (24 chars) doesn't fit;
            -- 'DryRunPasswordSet' (17 chars) does, same short-verb convention every other
            -- proc's audit rows already use.
            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('UserAccount', CAST(@MemberId AS NVARCHAR(40)), 'DryRunPasswordSet',
                    CONCAT(N'{"MemberId":', @MemberId, N',"LinkId":', @NewLinkId, N'}'),
                    @IssuedBy);
        END
    COMMIT;

    SET @LinkId = @NewLinkId;
    SET @ExpiresOnOut = @ExpiresOn;

    SELECT @NewLinkId AS LinkId, @ExpiresOn AS ExpiresOn;
END
GO
