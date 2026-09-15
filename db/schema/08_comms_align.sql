/* 08 — Announcements & Memos: bring 04_discipline_comms.sql's Announcement/Memo/ReadReceipt
   tables up to the shape the module needs. Additive only — nothing in 04 is dropped or
   narrowed, every guard below is idempotent, and this file is safe to re-run.

   (Numbered 08, not 05: 05 and 06 and 07 were already taken by 05_identity_renewal.sql,
   06_sequences.sql and 07_auth.sql by the time this was written. Filed after 07_auth.sql,
   which is the newest schema file at the time of writing, and follows its exact idioms —
   see the comment style and guard shape below.)

   Two design calls worth recording here because a future reader will otherwise wonder:

   1. MEMO NUMBERING — MEMO-<year>-<sequence>, never reused, formatted not reset.
      dbo.RenewalRefSeq and dbo.AckReceiptSeq (db/schema/06_sequences.sql) already
      establish this repo's pattern: ONE sequence that never resets, with the year
      taken from context and glued on as a separate string prefix at format time
      (see usp_Renewal_Submit's 'RNW-<year>-<NEXT VALUE, padded>' and
      usp_Renewal_Approve's 'AR-<year>-<NEXT VALUE, padded>'). dbo.MemoSeq follows
      the same approach rather than inventing a per-year-reset counter table — one
      fewer moving part, and every existing sequential-number proc in this codebase
      already reads this way, so a memo number is consistent with an AR number or a
      renewal reference at a glance.
      Padding is 4 digits (MEMO-2026-0001), not the 3 digits the spec's illustrative
      example shows (MEMO-2026-001), matching dbo.RenewalRefSeq's width rather than
      dbo.AckReceiptSeq's 5. Reasoning: MemoNumber is UNIQUE across the whole national
      deployment (hundreds of chapters), not per chapter, so a 3-digit field can be
      exhausted inside a single year at national scale; RIGHT('0000'+CAST(...),4) style
      formatting silently TRUNCATES leading digits once the underlying value overflows
      the pad width rather than erroring, so undersizing this is a real, silent
      duplicate-number risk, not a cosmetic one. 4 digits buys headroom without
      inventing a new format.

   2. SUPERSEDED-MEMO STATUS — tracked by a query join on Memo.SupersedesMemoId, not by
      a second column written back onto the superseded row. Memo.SupersedesMemoId
      (added below) already lets usp_Memo_GetForMember answer "is memo X superseded,
      and by what" with `EXISTS/JOIN dbo.Memo r ON r.SupersedesMemoId = m.MemoId` — no
      extra column needed. A chapter has tens to low hundreds of members and a modest
      number of memos a year, so this join costs nothing at the scale this system runs
      at (see CLAUDE.md "Performance"). The alternative — writing IsSuperseded /
      SupersededByMemoId back onto the old row when the new one publishes — would be a
      second place the same fact lives, and Memo has no update procedure at all (memos
      are immutable once published, by design: a correction is a NEW memo, never an
      edit to the old one) — introducing the one and only write-back onto a published
      memo, purely to cache a fact a join already gives for free, is not a trade worth
      making. IX_Memo_Supersedes below is what keeps that join cheap.

   DocumentAttachment is created here and left EMPTY. This slice ships memos and
   announcements text-only — there is no upload endpoint, no IFileStorage, and no
   screen that writes a row into this table yet. That is expected, not a bug: file
   storage is a prerequisite being built for a later module. The table exists now so
   the column shape is settled and nobody has to re-migrate live rows when the upload
   path lands. */

/* ---- UrgentType: BloodRequest | Assistance. Seeded in db/seed/01_reference.sql. ---- */
IF OBJECT_ID('dbo.UrgentType') IS NULL
CREATE TABLE dbo.UrgentType (
    UrgentTypeId INT IDENTITY PRIMARY KEY,
    TypeName     NVARCHAR(30) NOT NULL UNIQUE
);
GO

/* ---- Announcement: edit-with-a-visible-mark, soft withdrawal, structured urgent type. ---- */

/* Announcement.UrgentType (free text) stays exactly as it is — kept populated for
   backward compatibility this release. UrgentTypeId is the new structured FK; both are
   written by usp_Announcement_Create/_Edit going forward so neither reader is broken. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'UrgentTypeId')
    ALTER TABLE dbo.Announcement ADD UrgentTypeId INT NULL REFERENCES dbo.UrgentType(UrgentTypeId);
GO

/* No separate CreatedDate is added here. Announcement.PublishDate already is a
   NOT NULL DEFAULT SYSUTCDATETIME() column set once at INSERT and never touched by
   usp_Announcement_Edit (only EditedDate moves on an edit) — it already IS the
   creation timestamp. A second, always-identical CreatedDate column would just be
   two names for the same fact. */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'EditedBy')
    ALTER TABLE dbo.Announcement ADD EditedBy INT NULL REFERENCES dbo.Member(MemberId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'EditedDate')
    ALTER TABLE dbo.Announcement ADD EditedDate DATETIME2 NULL;
GO

/* Withdrawal is a soft hide with a mandatory reason — never a hard delete. A withdrawn
   announcement stays in the table forever; usp_Announcement_GetForMember excludes it
   from the default feed and usp_Announcement_Withdraw refuses to withdraw twice. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'IsWithdrawn')
    ALTER TABLE dbo.Announcement ADD IsWithdrawn BIT NOT NULL DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'WithdrawnBy')
    ALTER TABLE dbo.Announcement ADD WithdrawnBy INT NULL REFERENCES dbo.Member(MemberId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'WithdrawnDate')
    ALTER TABLE dbo.Announcement ADD WithdrawnDate DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'WithdrawnReason')
    ALTER TABLE dbo.Announcement ADD WithdrawnReason NVARCHAR(400) NULL;
GO

/* Optimistic concurrency token — Announcement had none. Needed once a row can be
   edited more than once (two officers editing the same announcement at once). */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Announcement') AND name = 'RowVersion')
    ALTER TABLE dbo.Announcement ADD RowVersion ROWVERSION;
GO

/* ---- Memo: immutable once published; a correction is a new memo that supersedes the old one. ---- */

/* Self-referencing: the NEW memo points at the one it replaces. The superseded row
   itself is never written to — see the header comment on tracking supersession by join. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Memo') AND name = 'SupersedesMemoId')
    ALTER TABLE dbo.Memo ADD SupersedesMemoId INT NULL REFERENCES dbo.Memo(MemoId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Memo') AND name = 'RowVersion')
    ALTER TABLE dbo.Memo ADD RowVersion ROWVERSION;
GO

/* ---- Polymorphic attachment table for comms (Announcement/Memo) only.
   dbo.ExpenseAttachment is untouched and stays the attachment table for expenses —
   this is a SEPARATE table on purpose, not a generalisation of that one. Empty until
   the file-storage module lands; see header comment. */
IF OBJECT_ID('dbo.DocumentAttachment') IS NULL
CREATE TABLE dbo.DocumentAttachment (
    AttachmentId INT IDENTITY PRIMARY KEY,
    DocumentType NVARCHAR(20) NOT NULL,
    DocumentId   INT NOT NULL,
    FilePath     NVARCHAR(400) NOT NULL,
    FileName     NVARCHAR(260) NOT NULL,
    FileSize     INT NOT NULL,
    UploadedBy   INT NOT NULL REFERENCES dbo.Member(MemberId),
    UploadedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_DocumentAttachment_Type CHECK (DocumentType IN ('Announcement', 'Memo'))
);
GO

/* ---- Sequence for MEMO-<year>-<NNNN>. See header comment for why this shape and width. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'MemoSeq')
    CREATE SEQUENCE dbo.MemoSeq AS INT START WITH 1 INCREMENT BY 1;
GO

/* A memo is immutable once published — a correction is a NEW memo that supersedes the
   old one, never an edit (see header comment). Until now that was enforced only by
   "no update/delete procedure exists", a social convention, not a technical one — every
   other hard-immutability rule in this schema (LedgerEntry, CorrectiveAction) is backed
   by an INSTEAD OF trigger so a stray ad-hoc UPDATE can't quietly break the guarantee.
   Bringing Memo in line with that same defence-in-depth standard. */
CREATE OR ALTER TRIGGER dbo.TR_Memo_NoUpdateDelete
ON dbo.Memo INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51184, 'Memo is immutable once published. Publish a new memo with SupersedesMemoId to correct it.', 1;
END
GO

/* ---- Indexes for the reads that actually happen. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Announcement_Scope_Publish')
    CREATE INDEX IX_Announcement_Scope_Publish ON dbo.Announcement(ScopeType, ScopeId, PublishDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Memo_Scope_Publish')
    CREATE INDEX IX_Memo_Scope_Publish ON dbo.Memo(ScopeType, ScopeId, PublishDate DESC);
/* Supports usp_Memo_GetForMember's "who supersedes me" join — see header comment. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Memo_Supersedes')
    CREATE INDEX IX_Memo_Supersedes ON dbo.Memo(SupersedesMemoId) WHERE SupersedesMemoId IS NOT NULL;
/* dbo.ReadReceipt already carries UQ_ReadReceipt (DocumentType, DocumentId, MemberId) —
   that constraint's leftmost columns already ARE the (document type + id) index the
   brief asks for, so no second index is added here; it would just duplicate the first
   two key columns of the existing unique index. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocumentAttachment_Doc')
    CREATE INDEX IX_DocumentAttachment_Doc ON dbo.DocumentAttachment(DocumentType, DocumentId);
GO
