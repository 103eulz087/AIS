/* Digital ID module, slice 1. Ensures the CALLER has a live (non-revoked, non-expired)
   dbo.MemberCredential row, and returns everything the ID card's front/back needs to
   render — never the QR token payload itself (that's CredentialService's job, backend
   slice, built on TokenSubject/KeyVersion returned here).

   NO @MemberId PARAMETER. Self-only by construction, same reasoning and same shape as
   usp_Member_GetOwnProfile / usp_Member_UpdateOwnProfile — @RequestingMemberId comes from
   the JWT and IS the row being read/issued for; there is no id here for a caller to
   substitute to get someone else's credential.

   IDEMPOTENT. Calling this twice in a row for the same member returns the SAME
   TokenSubject both times, as long as the existing credential is still live — it never
   mints a second credential for an already-current one. A NEW row is only inserted when
   none exists yet, or the existing one has been revoked or has expired.

   SUPERSEDING A STALE ROW. UX_MemberCredential_Member_Live (05_identity_renewal.sql)
   allows at most one MemberCredential row per member with RevokedDate IS NULL — so an
   expired-but-never-revoked row MUST be explicitly revoked before a replacement can be
   inserted, or the INSERT below would violate that index. This proc does that revoke
   itself, right before minting the new row, rather than leaving a trail of stale
   RevokedDate-IS-NULL rows behind (which is exactly the bug this index and this comment
   were added to close — see that index's own header for the full story).

   RACE SAFETY. The lookup below locks (UPDLOCK, HOLDLOCK) the member's one possible
   RevokedDate IS NULL row regardless of whether it turns out to be live or merely stale
   — not just the live-looking subset — so a concurrent second call for the same member
   always blocks on the first rather than each independently deciding "none exists" and
   racing to insert two. (Same posture as usp_MembershipApplication_Approve's
   NextMemberSeq capture — read and decide under one lock, never a bare SELECT followed
   by a separate, racy INSERT.)

   AUDIT (CLAUDE.md invariant #10). Written in the SAME transaction as the INSERT, and
   ONLY when a credential is actually newly issued — reading back an existing, still-live
   credential is not a write and is not audited.

   RenewedThrough is returned RAW and untransformed. NULL is the normal case today (no
   Portal renewal has ever run — see usp_Renewal_Approve's header) and means "renewal not
   yet recorded", not "lapsed". Wording that distinction is the API/frontend's job; this
   proc never coerces NULL into a fake date or a fake status string.

   Council chain: same recursive-walk-upward shape as usp_Chapter_ListPublic (itself
   modelled on usp_Council_GetSubtree, the system's scoping primitive), just anchored at
   this one member's home instead of every chapter. CK_Member_Home (02_members.sql)
   guarantees exactly one of ChapterId / HomeCouncilId is set, so the anchor is
   COALESCE(chapter's ParentCouncilId, member's HomeCouncilId) — this resolves correctly
   for both a chapter-homed member and a detached, council-homed member (invariant #14). */
CREATE OR ALTER PROCEDURE dbo.usp_Credential_GetOrIssueForSelf
    @RequestingMemberId INT,
    @ExpiryDate         DATETIME2 = NULL   -- defaults to 1 year from issuance if not supplied
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0)
        THROW 51260, 'Member not found.', 1;

    IF @ExpiryDate IS NULL
        SET @ExpiryDate = DATEADD(YEAR, 1, SYSUTCDATETIME());

    DECLARE @CredentialId INT, @TokenSubject UNIQUEIDENTIFIER, @KeyVersion INT, @IssuedNew BIT = 0;
    DECLARE @ExistingExpiry DATETIME2;

    BEGIN TRAN;
        -- At most one row can ever match (UX_MemberCredential_Member_Live) — locked here
        -- regardless of whether it turns out live or stale, so a concurrent call always
        -- blocks on this one, never races it.
        SELECT TOP (1)
                @CredentialId   = CredentialId,
                @TokenSubject   = TokenSubject,
                @KeyVersion     = PublicKeyVersion,
                @ExistingExpiry = ExpiryDate
        FROM    dbo.MemberCredential WITH (UPDLOCK, HOLDLOCK)
        WHERE   MemberId    = @RequestingMemberId
          AND   RevokedDate IS NULL;

        IF @CredentialId IS NOT NULL AND @ExistingExpiry <= SYSUTCDATETIME()
        BEGIN
            -- Stale: never revoked, but its time has passed. Supersede it so the new row
            -- below doesn't collide with it under UX_MemberCredential_Member_Live.
            UPDATE dbo.MemberCredential
               SET RevokedDate = SYSUTCDATETIME(), RevokedBy = @RequestingMemberId
             WHERE CredentialId = @CredentialId;
            SET @CredentialId = NULL;
        END

        IF @CredentialId IS NULL
        BEGIN
            INSERT dbo.MemberCredential (MemberId, ExpiryDate)
            VALUES (@RequestingMemberId, @ExpiryDate);

            SET @CredentialId = SCOPE_IDENTITY();

            SELECT @TokenSubject = TokenSubject, @KeyVersion = PublicKeyVersion
            FROM   dbo.MemberCredential
            WHERE  CredentialId = @CredentialId;

            INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
            VALUES ('MemberCredential', CAST(@CredentialId AS NVARCHAR(40)), 'Issue',
                    CONCAT(N'{"MemberId":', @RequestingMemberId,
                           N',"TokenSubject":"', @TokenSubject, N'"}'),
                    @RequestingMemberId);

            SET @IssuedNew = 1;
        END
    COMMIT;

    ;WITH StartPoint AS (
        SELECT  m.MemberId, m.ChapterId,
                ch.ChapterName, ch.ChapterCode,
                COALESCE(ch.ParentCouncilId, m.HomeCouncilId) AS AnchorCouncilId
        FROM    dbo.Member m
                LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
        WHERE   m.MemberId = @RequestingMemberId
    ),
    CouncilChain AS (
        SELECT  sp.MemberId, c.CouncilId, c.ParentCouncilId, c.CouncilName, cl.LevelName
        FROM    StartPoint sp
                JOIN dbo.Council c       ON c.CouncilId = sp.AnchorCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        UNION ALL
        SELECT  cc.MemberId, p.CouncilId, p.ParentCouncilId, p.CouncilName, cl.LevelName
        FROM    CouncilChain cc
                JOIN dbo.Council p       ON p.CouncilId = cc.ParentCouncilId
                JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = p.CouncilLevelId
    )
    SELECT  @TokenSubject AS TokenSubject,
            @KeyVersion   AS KeyVersion,
            @IssuedNew    AS IsNewlyIssued,
            mc.IssuedDate AS CredentialIssuedDate,
            mc.ExpiryDate AS CredentialExpiryDate,
            m.GiftName, m.FirstName, m.MiddleName, m.LastName,
            m.MemberNumber,
            sp.ChapterId, sp.ChapterName, sp.ChapterCode,
            MAX(CASE WHEN cc.LevelName = 'National'       THEN cc.CouncilName END) AS NationalCouncilName,
            MAX(CASE WHEN cc.LevelName = 'Regional'       THEN cc.CouncilName END) AS RegionName,
            MAX(CASE WHEN cc.LevelName = 'Provincial'     THEN cc.CouncilName END) AS ProvinceName,
            MAX(CASE WHEN cc.LevelName = 'City/Municipal' THEN cc.CouncilName END) AS CityName,
            m.DateSurvive,
            bt.BloodTypeName,
            ms.StatusName,
            m.RenewedThrough        -- raw, nullable, never transformed here
    FROM    dbo.Member m
            JOIN StartPoint sp           ON sp.MemberId = m.MemberId
            JOIN dbo.MemberCredential mc  ON mc.CredentialId = @CredentialId
            JOIN dbo.MemberStatus ms      ON ms.StatusId = m.StatusId
            LEFT JOIN dbo.BloodType bt    ON bt.BloodTypeId = m.BloodTypeId
            LEFT JOIN CouncilChain cc     ON cc.MemberId = m.MemberId
    WHERE   m.MemberId = @RequestingMemberId
    GROUP BY mc.IssuedDate, mc.ExpiryDate, m.GiftName, m.FirstName, m.MiddleName, m.LastName,
             m.MemberNumber, sp.ChapterId, sp.ChapterName, sp.ChapterCode, m.DateSurvive,
             bt.BloodTypeName, ms.StatusName, m.RenewedThrough
    OPTION (MAXRECURSION 20);
END
GO
