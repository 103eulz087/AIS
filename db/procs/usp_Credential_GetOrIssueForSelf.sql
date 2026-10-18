/* Digital ID module, slice 1. Ensures the CALLER has a live (non-revoked, non-expired)
   dbo.MemberCredential row, and returns everything the ID card's front/back needs to
   render — never the QR token payload itself (that's CredentialService's job, backend
   slice, built on TokenSubject/KeyVersion returned here).

   IsPaid (added 2026-09-29): the standalone payment tag (dbo.MemberPaymentTagAction,
   db/schema/25_member_payment_tag.sql), NOT RenewedThrough/MemberRenewal.RenewalStatus —
   deliberately a second, independent signal per that schema's own header. An untagged
   member (no action row for the current membership year) reads as NOT paid — client
   decision 2026-09-29, same "no row = false" default usp_MemberPaymentTag_GetChapterMembers
   already uses — so the frontend's "NOT YET PAID" watermark is the default for the whole
   roster until National works through it, not an opt-in flag.

   HasChapterLogo / MarkAccentHex (added 2026-09-29): the chapter mark, image slice.
   dbo.Chapter.LogoPath sat unused since 17_chapter_registration.sql — this is its first
   consumer. Only a boolean travels through this proc/DTO layer, never the path itself
   (same "never a raw storage path over the wire" posture the rest of this system uses
   for PhotoPath/PhotoUrl) — the frontend resolves the real bytes via
   GET /api/members/me/chapter-logo instead.

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

    -- Same 09-Aug-anchored membership year every payment-tag proc uses (mirrors
    -- Akrho.Domain.MembershipYear.YearFor) — the payment tag is deliberately a SEPARATE
    -- signal from RenewedThrough below (client decision 2026-09-29, db/schema/
    -- 25_member_payment_tag.sql's own header). An untagged member defaults to NOT paid
    -- (client decision 2026-09-29) — every existing member starts this way until National
    -- works through the roster; this is the same "no row = false" default
    -- usp_MemberPaymentTag_GetChapterMembers already uses, just reused here.
    DECLARE @CurrentMembershipYear INT;
    DECLARE @Today2 DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @Anniversary2 DATE = DATEFROMPARTS(YEAR(@Today2), 8, 8);
    SET @CurrentMembershipYear = CASE WHEN @Today2 > @Anniversary2 THEN YEAR(@Today2) ELSE YEAR(@Today2) - 1 END;

    DECLARE @CredentialId INT, @TokenSubject UNIQUEIDENTIFIER, @KeyVersion INT, @IssuedNew BIT = 0;
    DECLARE @ExistingExpiry DATETIME2;
    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

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
                ch.LogoPath, ch.MarkAccentId,
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
    ),
    LatestTag AS (
        SELECT  TOP (1) ActionType
        FROM    dbo.MemberPaymentTagAction
        WHERE   MemberId = @RequestingMemberId AND MembershipYear = @CurrentMembershipYear
        ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC
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
            m.RenewedThrough,       -- raw, nullable, never transformed here
            -- The office he currently holds, if any — drives the officer card (red/black
            -- instead of the member card's green/black) and the position line on its
            -- front. NULL for a plain member. One office only: a council seat outranks a
            -- chapter seat (higher council first), then chapter offices by SortOrder.
            -- Shown on his OWN card only — never added to the public verification page or
            -- the QR (invariant #8).
            pos.OfficeName          AS OfficePosition,
            pos.OfficeBody          AS OfficeBody,
            -- 'Free' (added 2026-10-06) suppresses the watermark exactly like 'Tagged' —
            -- see 27_member_payment_tag_free_status.sql's own header.
            CAST(CASE WHEN lt.ActionType IN ('Tagged', 'Free') THEN 1 ELSE 0 END AS BIT) AS IsPaid,
            -- Chapter mark, image slice (2026-09-29): LogoPath is NULL until the chapter's
            -- President uploads one (usp_Chapter_SetLogo) — the API layer, not this proc,
            -- turns a non-NULL path into a servable URL. MarkAccentHex is the fallback
            -- monogram colour (ChapterMonogram.tsx) for a chapter with no logo yet.
            CASE WHEN sp.LogoPath IS NOT NULL THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasChapterLogo,
            ca.HexValue AS MarkAccentHex
    FROM    dbo.Member m
            JOIN StartPoint sp           ON sp.MemberId = m.MemberId
            JOIN dbo.MemberCredential mc  ON mc.CredentialId = @CredentialId
            JOIN dbo.MemberStatus ms      ON ms.StatusId = m.StatusId
            LEFT JOIN dbo.BloodType bt    ON bt.BloodTypeId = m.BloodTypeId
            LEFT JOIN CouncilChain cc     ON cc.MemberId = m.MemberId
            OUTER APPLY (
                SELECT TOP (1) x.OfficeName, x.OfficeBody
                FROM (
                    SELECT  co.OfficeName, c.CouncilName AS OfficeBody,
                            0 AS ScopeRank, cl.LevelOrder AS SortKey
                    FROM    dbo.MemberRole mr
                            JOIN dbo.CouncilOffice co ON co.CouncilOfficeId = mr.CouncilOfficeId
                            JOIN dbo.Council c        ON c.CouncilId = mr.ScopeId
                            JOIN dbo.CouncilLevel cl  ON cl.CouncilLevelId = c.CouncilLevelId
                    WHERE   mr.MemberId = m.MemberId AND mr.ScopeType = 'Council'
                      AND   mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                    UNION ALL
                    SELECT  o.OfficeName, ch.ChapterName,
                            1, o.SortOrder
                    FROM    dbo.MemberRole mr
                            JOIN dbo.ChapterOffice o ON o.OfficeId = mr.OfficeId
                            JOIN dbo.Chapter ch      ON ch.ChapterId = mr.ScopeId
                    WHERE   mr.MemberId = m.MemberId AND mr.ScopeType = 'Chapter'
                      AND   mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
                ) x
                ORDER BY x.ScopeRank, x.SortKey
            ) pos
            LEFT JOIN LatestTag lt        ON 1 = 1
            LEFT JOIN dbo.ChapterAccent ca ON ca.AccentId = sp.MarkAccentId
    WHERE   m.MemberId = @RequestingMemberId
    GROUP BY mc.IssuedDate, mc.ExpiryDate, m.GiftName, m.FirstName, m.MiddleName, m.LastName,
             m.MemberNumber, sp.ChapterId, sp.ChapterName, sp.ChapterCode, m.DateSurvive,
             bt.BloodTypeName, ms.StatusName, m.RenewedThrough,
             pos.OfficeName, pos.OfficeBody, lt.ActionType,
             sp.LogoPath, ca.HexValue
    OPTION (MAXRECURSION 20);
END
GO
