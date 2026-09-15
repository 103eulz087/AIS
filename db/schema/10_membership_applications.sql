/* 10 — Membership applications: a chapter's own sign-up-and-approve queue.
   §4.1 of the spec, and CLAUDE.md invariant #13 — members are created by CHAPTERS ONLY,
   never a council. usp_MembershipApplication_Approve (db/procs/) is the ONLY INSERT path
   into dbo.Member in this whole codebase; this file adds nothing that creates a second one.

   Two scope decisions this file builds to (see the task brief, not repeated in full here):
     1. No photo at application — a photo is a later, authenticated concern (chapter admin
        at review, or the member himself post-enrolment). No attachment column here.
     2. Short form only — blood type, skills, profession, address stay OFF this table;
        they belong to the member's own profile, filled in after first sign-in.

   Design calls worth recording here because a future reader will otherwise wonder:

   1. THE SECONDER IS FREE TEXT AT SUBMIT TIME, ON PURPOSE. A public, unauthenticated
      endpoint that confirms "yes, member number X exists and is named Y" is a
      membership-enumeration oracle. SeconderNameGiven / SeconderMemberNumberGiven are
      exactly what the applicant typed, unvalidated. SeconderMemberId is filled in later,
      by the chapter admin, at review — an authenticated actor who already has the
      chapter's own roster in front of him.

   2. "OPEN" IS A MAINTAINED BOOLEAN, NOT A HARDCODED STATUS-ID FILTER. The task shape
      for this asked for a filtered unique index directly on StatusId IN (<PendingApproval>,
      <ReturnedForCorrection>) to stop a duplicate open application for the same mobile
      number/chapter. SQL Server filtered-index predicates must be constant expressions —
      no subquery, no join back to a lookup table — so that literally means baking the
      SEEDED SURROGATE KEYS for those two status rows into permanent DDL as bare integers.
      Every other place in this codebase that needs a status resolves it BY NAME at run
      time (SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = 'Active', over and
      over) specifically so nobody ever has to know or guess what a seeded id happens to
      be; hardcoding two of those ids into an index definition would be the one place that
      habit is broken, and it would fail silently (no error, just a quietly-wrong filter)
      the day the seed order ever changes. Instead, MembershipApplication carries a
      maintained IsOpen BIT — true while PendingApproval or ReturnedForCorrection, flipped
      to 0 by usp_MembershipApplication_Approve and usp_MembershipApplication_Reject, left
      at 1 by usp_MembershipApplication_Return (still open) and re-set to 1 by
      usp_MembershipApplication_Resubmit (back to PendingApproval). The filtered unique
      index below is built on THAT column. Same guarantee the task asked for — one open
      application per (chapter, mobile) — with no seeded-id assumption baked into DDL.

   3. MembershipApplicationStatus is a SEPARATE reference table from dbo.MemberStatus.
      dbo.MemberStatus already has rows that sound similar (Pending, Rejected) but they
      describe a MEMBER's renewal/standing state, not an APPLICATION's decision state —
      two different concepts that happen to rhyme in English. Reusing MemberStatus rows
      here would quietly couple two lifecycles that must be free to diverge (an application
      is Approved once, permanently; a member's standing changes every year).

   4. Chapter.MemberNumberPrefix / NextMemberSeq are a STOPGAP. Proper region/chapter code
      assignment belongs to the chapter-registration module (not built yet); this pair of
      columns exists only so usp_MembershipApplication_Approve has something to allocate
      a member number from today. NextMemberSeq is captured and incremented in the SAME
      UPDATE statement (never a separate SELECT then UPDATE) — see that proc's own header
      comment for the race this avoids, the same one the meeting-finalize fix already
      closed elsewhere in this project. */

/* ---- MembershipApplicationStatus: PendingApproval | ReturnedForCorrection | Approved | Rejected.
   Seeded in db/seed/01_reference.sql, same convention as every other controlled list. ---- */
IF OBJECT_ID('dbo.MembershipApplicationStatus') IS NULL
CREATE TABLE dbo.MembershipApplicationStatus (
    StatusId   INT IDENTITY PRIMARY KEY,
    StatusName NVARCHAR(30) NOT NULL UNIQUE
);
GO

IF OBJECT_ID('dbo.MembershipApplication') IS NULL
CREATE TABLE dbo.MembershipApplication (
    ApplicationId INT IDENTITY PRIMARY KEY,
    ReferenceNo   NVARCHAR(20)  NOT NULL UNIQUE,   -- applicant-facing tracking number. NOT a MemberNumber.
    ChapterId     INT           NOT NULL REFERENCES dbo.Chapter(ChapterId),
    FirstName     NVARCHAR(80)  NOT NULL,
    MiddleName    NVARCHAR(80)  NULL,
    LastName      NVARCHAR(80)  NOT NULL,
    GiftName      NVARCHAR(60)  NOT NULL,
    BirthDate     DATE          NOT NULL,
    MobileNo      NVARCHAR(30)  NOT NULL,
    Email         NVARCHAR(200) NULL,
    DateSurvive   DATE          NULL,
    PresidentDuringSurvive       NVARCHAR(200) NULL,
    MasterInitiatorDuringSurvive NVARCHAR(200) NULL,
    /* Free text at submit time — see design note 1 above. Never validated against
       dbo.Member here; SeconderMemberId below is the admin's later, authenticated
       confirmation of who this actually refers to. */
    SeconderNameGiven         NVARCHAR(160) NOT NULL,
    SeconderMemberNumberGiven NVARCHAR(30)  NULL,
    SeconderMemberId          INT NULL REFERENCES dbo.Member(MemberId),
    StatusId      INT NOT NULL REFERENCES dbo.MembershipApplicationStatus(StatusId),
    /* Maintained by every proc that changes StatusId — see design note 2 above.
       True for PendingApproval / ReturnedForCorrection, false once decided. */
    IsOpen        BIT NOT NULL DEFAULT 1,
    SubmittedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    DecidedBy     INT NULL REFERENCES dbo.Member(MemberId),
    DecidedDate   DATETIME2 NULL,
    DecisionReason NVARCHAR(500) NULL,
    CreatedMemberId INT NULL REFERENCES dbo.Member(MemberId),
    RowVersion    ROWVERSION,
    /* Defence in depth alongside usp_MembershipApplication_Submit/_Resubmit's own THROW —
       "a real past date", no invented minimum age (an open business question, not settled
       here). Evaluated at write time; a date already in the past never becomes false later. */
    CONSTRAINT CK_MembershipApplication_BirthDate CHECK (BirthDate < CAST(SYSUTCDATETIME() AS DATE))
);
GO

/* One open application per (chapter, mobile number) — a server-side double-submit guard.
   usp_MembershipApplication_Submit catches the rare concurrent-double-submit race (two
   requests landing at once) via TRY/CATCH on the constraint violation and hands back the
   EXISTING reference number rather than a raw error. See design note 2 for why this is
   built on IsOpen rather than a literal StatusId filter. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MembershipApplication_Open')
    CREATE UNIQUE INDEX UX_MembershipApplication_Open
        ON dbo.MembershipApplication(ChapterId, MobileNo) WHERE IsOpen = 1;
GO

/* The queue: a chapter admin's own applications, newest first, optionally by status. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MembershipApplication_Chapter_Status')
    CREATE INDEX IX_MembershipApplication_Chapter_Status
        ON dbo.MembershipApplication(ChapterId, StatusId, SubmittedDate DESC);
GO

/* Supports usp_MembershipApplication_Get's "has this mobile number applied before"
   cross-application lookup — see that proc's header comment. National scale eventually,
   so this earns its keep (CLAUDE.md "Performance"). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MembershipApplication_MobileNo')
    CREATE INDEX IX_MembershipApplication_MobileNo ON dbo.MembershipApplication(MobileNo);
GO

/* ---- MembershipApplicationUpdate: append-only history, one row per status change.
   Same shape and reasoning as dbo.MeetingReopen / dbo.CorrectiveActionUpdate — a status
   can change more than once (submitted → returned → resubmitted → approved) and each
   occurrence keeps its OWN note, never overwritten. No update/delete procedure exists for
   this table and none should ever be added; that is the whole point of the shape. ---- */
IF OBJECT_ID('dbo.MembershipApplicationUpdate') IS NULL
CREATE TABLE dbo.MembershipApplicationUpdate (
    MembershipApplicationUpdateId INT IDENTITY PRIMARY KEY,
    ApplicationId INT NOT NULL REFERENCES dbo.MembershipApplication(ApplicationId),
    UpdateDate    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedBy     INT NULL REFERENCES dbo.Member(MemberId),  -- NULL: an applicant's own resubmit — no authenticated actor
    StatusId      INT NOT NULL REFERENCES dbo.MembershipApplicationStatus(StatusId),
    Notes         NVARCHAR(500) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MembershipApplicationUpdate_Application')
    CREATE INDEX IX_MembershipApplicationUpdate_Application
        ON dbo.MembershipApplicationUpdate(ApplicationId, UpdateDate);
GO

/* ---- Sequence for APP-<year>-<NNNNN>. Never reset, year glued on as display prefix at
   format time — same idiom as dbo.RenewalRefSeq / dbo.MemoSeq (db/schema/06_sequences.sql,
   08_comms_align.sql). 5-digit pad, matching dbo.AckReceiptSeq rather than the 4-digit
   width used for renewals/memos: an application is filed per PROSPECTIVE MEMBER, at
   national scale, every time anyone signs up at any of thousands of chapters — a strictly
   higher-volume event than a memo or a chapter's once-a-year renewal reference, so the
   narrower pad is the wrong one to copy here. Under-sizing this silently TRUNCATES leading
   digits past the pad width rather than erroring — see 08_comms_align.sql's header comment
   for why that makes undersizing a real duplicate-number risk, not a cosmetic one. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'MembershipApplicationSeq')
    CREATE SEQUENCE dbo.MembershipApplicationSeq AS INT START WITH 1 INCREMENT BY 1;
GO

/* ---- Chapter.MemberNumberPrefix / NextMemberSeq — a STOPGAP. See design note 4 above.
   NextMemberSeq starts at 1 for a chapter with no numbered members yet; the demo chapter
   is backfilled below to match its 5 already-seeded members. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'MemberNumberPrefix')
    ALTER TABLE dbo.Chapter ADD MemberNumberPrefix NVARCHAR(12) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'NextMemberSeq')
    ALTER TABLE dbo.Chapter ADD NextMemberSeq INT NOT NULL DEFAULT 1;
GO

/* Demo-chapter backfill only. The 5 seeded members in db/seed/02_demo_chapter.sql are
   AKR-04-0117-001 .. -005, so the prefix is 'AKR-04-0117' and the next free sequence value
   is 6. Guarded so this is a no-op once it has run, and so it never touches a chapter
   that already has a prefix configured (a real chapter's prefix is this stopgap's whole
   reason for existing — nobody should overwrite one by re-running this file). */
UPDATE dbo.Chapter
   SET MemberNumberPrefix = 'AKR-04-0117',
       NextMemberSeq = 6
 WHERE ChapterName = 'Brgy. San Isidro Chapter'
   AND MemberNumberPrefix IS NULL;
GO
