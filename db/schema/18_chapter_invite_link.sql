/* 18 — Chapter invite links: a Chapter Admin's own permanent, shareable join
   link/QR code for his chapter, so a prospective member who already knows which
   chapter he's joining skips the public Region -> Province -> City -> Chapter
   cascade entirely (usp_Chapter_ListPublic / Apply.tsx). That cascade stays for
   anyone WITHOUT a link — this is additive, not a replacement.

   Same opaque-token discipline as EnrolmentLink/MemberCredential: only the SHA-256
   hash is ever stored (Akrho.Infrastructure.Security.OpaqueToken, the same
   generator/hasher every other bearer token in this codebase uses); the raw token
   is shown to the Chapter Admin ONCE, at creation, embedded in the link/QR he
   copies — there is no way to recover it later, only to regenerate (which
   invalidates whatever was live before, same "supersede a stale row" pattern as
   MemberCredential/EnrolmentLink).

   PERMANENT BY DECISION (2026-09-20) — no ExpiresOn column. If this ever needs a
   TTL, add ExpiresOn nullable rather than assuming NULL means "no expiry" was
   always the intent; that decision should read as deliberate here, not accidental.

   A chapter link is not a login credential — unlike EnrolmentLink, redeeming it
   never creates an account or a Member row by itself. It only pre-fills a
   PUBLIC, anonymous membership APPLICATION's chosen chapter (still reviewed and
   approved by that chapter's own admin, same as ever — invariant #13 is
   untouched: a council still enrols nobody, and now neither does a bare link). */
IF OBJECT_ID('dbo.ChapterInviteLink') IS NULL
CREATE TABLE dbo.ChapterInviteLink (
    ChapterInviteLinkId INT IDENTITY PRIMARY KEY,
    ChapterId     INT           NOT NULL REFERENCES dbo.Chapter(ChapterId),
    TokenHash     VARBINARY(32) NOT NULL UNIQUE,
    CreatedBy     INT           NOT NULL REFERENCES dbo.Member(MemberId),
    CreatedDate   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    InvalidatedOn DATETIME2     NULL,
    InvalidatedBy INT           NULL REFERENCES dbo.Member(MemberId)
);
GO
/* At most one LIVE link per chapter — the same filtered-unique-index shape as
   UX_MemberCredential_Member_Live (05_identity_renewal.sql), for the identical
   reason: "not yet invalidated" must mean the same thing to every writer, so a
   regenerate MUST invalidate the old row before/in the same transaction as
   inserting the new one, never leave two live rows for one chapter. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ChapterInviteLink_Chapter_Live')
    CREATE UNIQUE INDEX UX_ChapterInviteLink_Chapter_Live
        ON dbo.ChapterInviteLink(ChapterId) WHERE InvalidatedOn IS NULL;
GO
