/* 13 — Digital ID module (slice 1: database layer only).

   CLAUDE.md invariant #8: the QR token payload carries an opaque "chp" (chapter code),
   never the chapter's internal ChapterId and never a name. dbo.Chapter has no such
   column today. MemberNumberPrefix (db/schema/10_membership_applications.sql, itself
   labelled a STOPGAP there) is the closest thing that exists: it stores the WHOLE
   AKR-RR-CCCC prefix as one opaque string per chapter (e.g. 'AKR-04-0117').

   ChapterCode below is the CCCC segment alone — the 3rd dash-separated part of
   MemberNumberPrefix — derived once for every chapter whose prefix already follows that
   exact 3-segment shape. A chapter with no MemberNumberPrefix configured yet, or one
   whose prefix doesn't split into exactly 3 non-empty dash-separated parts, is left
   ChapterCode = NULL on purpose. This migration REPORTS which chapters those are (the
   SELECT near the bottom) rather than guessing at a code for them — assigning one is the
   chapter-registration module's job (see the STOPGAP note referenced above), not this
   migration's, and a wrong guess would end up baked into printed QR codes and IDs.

   This file also adds the two read-performance indexes the Digital ID module needs on
   dbo.MemberCredential / dbo.ScanLog — both tables already exist and are unchanged here
   (05_identity_renewal.sql). dbo.MemberCredential.PublicKeyVersion (added in that same
   file) already IS the "which key signed this credential's tokens" column the module
   needs — surfaced as "KeyVersion" in usp_Credential_GetOrIssueForSelf's result set — so
   no new column is added for that; renaming an already-existing, already-well-designed
   column would be pure churn. Likewise dbo.MemberSeal (year seals) already exists; this
   slice does not touch it — year-seal issuance is a later module. */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'ChapterCode')
    ALTER TABLE dbo.Chapter ADD ChapterCode NVARCHAR(10) NULL;
GO

/* One-time backfill. Idempotent: only ever touches a row whose ChapterCode is still NULL,
   so re-running this file never overwrites a code assigned since (by this script, or
   later by the chapter-registration module once it owns proper code assignment). */
UPDATE ch
   SET ChapterCode = t.Segment3
FROM dbo.Chapter ch
CROSS APPLY (
    SELECT Segment3 = CASE
        WHEN ch.MemberNumberPrefix IS NULL THEN NULL
        -- Must be exactly 3 dash-separated segments (AKR-RR-CCCC): exactly 2 dashes.
        WHEN LEN(ch.MemberNumberPrefix) - LEN(REPLACE(ch.MemberNumberPrefix, '-', '')) <> 2 THEN NULL
        ELSE NULLIF(
                SUBSTRING(
                    ch.MemberNumberPrefix,
                    CHARINDEX('-', ch.MemberNumberPrefix, CHARINDEX('-', ch.MemberNumberPrefix) + 1) + 1,
                    LEN(ch.MemberNumberPrefix)
                ),
                ''  -- a trailing dash ('AKR-04-') has the right dash count but an empty 3rd segment
             )
    END
) t
WHERE ch.ChapterCode IS NULL;
GO

/* A chapter code carried in a QR payload must be unique — filtered so chapters not yet
   derivable/configured (ChapterCode NULL) never collide with each other under it. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Chapter_ChapterCode')
    CREATE UNIQUE INDEX UX_Chapter_ChapterCode ON dbo.Chapter(ChapterCode) WHERE ChapterCode IS NOT NULL;
GO

/* Fast "does this member have a live credential" lookup — usp_Credential_GetOrIssueForSelf's
   idempotency check runs this on every call. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MemberCredential_Member_Live')
    CREATE INDEX IX_MemberCredential_Member_Live ON dbo.MemberCredential(MemberId) WHERE RevokedDate IS NULL;
GO

/* Scan history for a credential, newest first — usp_Credential_VerifyPublic's audit trail
   and a future "this member's ID was scanned N times" admin screen both read this way. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScanLog_Credential_ScanDate')
    CREATE INDEX IX_ScanLog_Credential_ScanDate ON dbo.ScanLog(CredentialId, ScanDate DESC);
GO

/* Migration report — runs every deploy, not just the first one. Any active chapter still
   without a ChapterCode needs manual attention (a missing or malformed MemberNumberPrefix)
   before its members can be issued a Digital ID QR. This is informational, not an error:
   it must never block deployment for a chapter that isn't ready yet. */
PRINT 'usp_Credential: chapters still needing a ChapterCode assigned manually (see MemberNumberPrefix):';
SELECT ChapterId, ChapterName, MemberNumberPrefix
FROM   dbo.Chapter
WHERE  ChapterCode IS NULL AND IsActive = 1
ORDER BY ChapterName;
GO
