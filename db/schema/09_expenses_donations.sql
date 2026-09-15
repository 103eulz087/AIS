/* 09 — Expenses, donations and shared attachment staging. Additive only — everything in
   03_meetings_money.sql (Expense, ExpenseAttachment, Donation, Activity, LedgerEntry and
   its append-only trigger) stays exactly as it is; this file only extends it. Idempotent,
   same idioms as db/schema/08_comms_align.sql (IF OBJECT_ID / sys.columns / sys.indexes
   guards, safe to re-run).

   Design calls worth recording here because a future reader will otherwise wonder:

   1. NO "FINALIZE" CEREMONY. An expense or donation records money/goods that have
      already changed hands — there is nothing partial to accumulate the way a meeting's
      collection is. usp_Expense_Create / usp_Donation_Create post to the ledger
      immediately, in the SAME transaction as the record. Correction is VOID (soft-hide +
      usp_Ledger_Reverse + a mandatory reason), never a delete, never a draft state.

   2. Expense.ApprovedBy (already on the table) is NOT a workflow gate. It stays a
      nullable, optional countersignature column — there is no status column to hold an
      approval state machine, and none is being added.

   3. IN-KIND DONATIONS POST NOTHING TO THE LEDGER. CK_Ledger_Amount already forbids a
      zero-amount ledger row, correctly — an in-kind gift is real and appears in the
      donation list/detail with Amount = 0 and a populated InKindDescription, and simply
      creates no LedgerEntry row. usp_Donation_Void mirrors usp_Meeting_Reopen's "skip the
      reversal when there was nothing to reverse" branch.

   4. DONATION VOID STATE IS DERIVED, NOT STORED. Expense already carries IsDeleted
      (pre-existing column, reused here as the void flag) — Donation does not, and this
      file does not add one. Whether a donation is voided is answered by EXISTS/NOT EXISTS
      against dbo.DonationVoid, the same way usp_Meeting_Get derives "was this meeting
      reopened" from dbo.MeetingReopen rather than a cached flag on dbo.Meeting. A chapter
      runs a modest number of donations a year, so the join costs nothing at this scale
      (see CLAUDE.md "Performance").

   5. Donation's own receipt-book number (the chapter's OWN paper receipt, kept here as
      free text) is renamed AckReceiptNo -> ChapterReceiptNo. It is NOT the Portal's
      AckReceipt sequence (invariant #3's numbers-never-reused lifecycle belongs to a
      different application) and must never be confused with it — hence the rename away
      from anything that reads as "AR number".

   6. AttachmentStaging is a generic pre-attach staging table only. The upload endpoint
      that writes rows into it (IFileStorage, the controller action) is a separate,
      later backend task — this file only settles the column shape, exactly the same
      posture 08_comms_align.sql took with dbo.DocumentAttachment. */

/* ---- ExpenseCategory: controlled list, seeded in db/seed/01_reference.sql. ---- */
IF OBJECT_ID('dbo.ExpenseCategory') IS NULL
CREATE TABLE dbo.ExpenseCategory (
    CategoryId   INT IDENTITY PRIMARY KEY,
    CategoryName NVARCHAR(60) NOT NULL UNIQUE
);
GO

/* Nullable: a new column on an existing table, no backfill — category is optional
   for this release, exactly as an already-recorded expense predates the concept. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Expense') AND name = 'CategoryId')
    ALTER TABLE dbo.Expense ADD CategoryId INT NULL REFERENCES dbo.ExpenseCategory(CategoryId);
GO

/* Widened to match usp_Expense_Create's @Description NVARCHAR(MAX) and @Payee
   NVARCHAR(200) — same idiom as this file's sibling widening of Meeting.Location at the
   top of 03_meetings_money.sql. Description was NVARCHAR(400) NOT NULL and Payee was
   NVARCHAR(150) NOT NULL; a receipt narrative or a payee's registered business name can
   run longer than either, and silently truncating is worse than a wider column. Both
   guards are no-ops once re-run against an already-widened column. */
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.Expense') AND name = 'Description' AND max_length > 0)
    ALTER TABLE dbo.Expense ALTER COLUMN Description NVARCHAR(MAX) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.Expense') AND name = 'Payee' AND max_length < 400)
    ALTER TABLE dbo.Expense ALTER COLUMN Payee NVARCHAR(200) NOT NULL;
GO

/* ---- ExpenseVoid: a CHILD table, same reasoning as dbo.MeetingReopen — an expense
   could in principle be voided more than once in its lifetime (voided, a correcting
   expense entered, that one voided too), and each occurrence keeps its OWN reason,
   never overwritten. ---- */
IF OBJECT_ID('dbo.ExpenseVoid') IS NULL
CREATE TABLE dbo.ExpenseVoid (
    ExpenseVoidId   INT IDENTITY PRIMARY KEY,
    ExpenseId       INT NOT NULL REFERENCES dbo.Expense(ExpenseId),
    VoidedBy        INT NOT NULL REFERENCES dbo.Member(MemberId),
    VoidedDate      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Reason          NVARCHAR(400) NOT NULL,
    ReversedLedgerEntryId INT NULL REFERENCES dbo.LedgerEntry(LedgerEntryId)
);
GO

/* ---- DonorType: controlled list, kept ALONGSIDE Donation's existing free-text
   DonorType column (same backward-compat approach as Announcement.UrgentTypeId /
   UrgentType in 08_comms_align.sql — both populated going forward). ---- */
IF OBJECT_ID('dbo.DonorType') IS NULL
CREATE TABLE dbo.DonorType (
    DonorTypeId INT IDENTITY PRIMARY KEY,
    TypeName    NVARCHAR(40) NOT NULL UNIQUE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Donation') AND name = 'DonorTypeId')
    ALTER TABLE dbo.Donation ADD DonorTypeId INT NULL REFERENCES dbo.DonorType(DonorTypeId);
GO

/* Donation.DonorType (free text) was NOT NULL — unlike Announcement.UrgentType, which
   was already nullable when its own UrgentTypeId companion was added in
   08_comms_align.sql. usp_Donation_Create's @DonorTypeId parameter is optional (a new
   structured field on an existing table), so the free-text column has to tolerate "not
   supplied" too, or the proc would be forced to invent a fake default value just to
   satisfy NOT NULL. Widening a constraint (NOT NULL -> NULL) is backward compatible —
   every existing row already satisfies it. */
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.Donation') AND name = 'DonorType' AND is_nullable = 0)
    ALTER TABLE dbo.Donation ALTER COLUMN DonorType NVARCHAR(40) NULL;
GO

/* ---- DonationVoid: same shape as ExpenseVoid, mirroring it exactly. No IsVoided flag
   on Donation itself — see design note 4 above; "voided?" is answered by this table's
   existence, not a cached column. ---- */
IF OBJECT_ID('dbo.DonationVoid') IS NULL
CREATE TABLE dbo.DonationVoid (
    DonationVoidId  INT IDENTITY PRIMARY KEY,
    DonationId      INT NOT NULL REFERENCES dbo.Donation(DonationId),
    VoidedBy        INT NOT NULL REFERENCES dbo.Member(MemberId),
    VoidedDate      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Reason          NVARCHAR(400) NOT NULL,
    ReversedLedgerEntryId INT NULL REFERENCES dbo.LedgerEntry(LedgerEntryId)
);
GO

/* ---- Rename Donation.AckReceiptNo -> ChapterReceiptNo. Same field, same free-text
   nature (the chapter's own paper receipt book) — renamed ONLY so nobody ever reads it
   as, or aliases it to, the Portal's council-issued AckReceipt (a different application,
   a different number-never-reused lifecycle — invariant #3). Guarded both ways so this
   script is safe whether it has already run or not. ---- */
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Donation') AND name = 'AckReceiptNo')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Donation') AND name = 'ChapterReceiptNo')
    EXEC sp_rename 'dbo.Donation.AckReceiptNo', 'ChapterReceiptNo', 'COLUMN';
GO

/* Widened to match usp_Donation_Create's @ChapterReceiptNo NVARCHAR(60) — the column
   (under its old name) was NVARCHAR(40). Same widen-to-match-the-proc idiom as
   Expense.Description above and Meeting.Location in 03_meetings_money.sql. */
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.Donation') AND name = 'ChapterReceiptNo' AND max_length < 120)
    ALTER TABLE dbo.Donation ALTER COLUMN ChapterReceiptNo NVARCHAR(60) NULL;
GO

/* Defence in depth alongside usp_Donation_Create's own friendly THROW: a donation is
   cash, goods, or both — never neither. dbo.Donation.InKindDescription already exists
   with exactly this purpose (no column added here). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Donation_CashOrKind')
    ALTER TABLE dbo.Donation WITH CHECK
    ADD CONSTRAINT CK_Donation_CashOrKind CHECK (Amount > 0 OR InKindDescription IS NOT NULL);
GO

/* ---- Generic pre-attach staging. An officer uploads a receipt image via a backend
   endpoint (not built here — see design note 6), gets back a staging id, and references
   it when creating the expense; usp_Expense_Create claims the staged row atomically in
   the same transaction as the Expense insert. ConsumedDate IS NULL means still
   staged/unclaimed; a later sweeper job (not this task) deletes old unclaimed rows. ---- */
IF OBJECT_ID('dbo.AttachmentStaging') IS NULL
CREATE TABLE dbo.AttachmentStaging (
    AttachmentStagingId INT IDENTITY PRIMARY KEY,
    UploadedBy   INT NOT NULL REFERENCES dbo.Member(MemberId),
    ChapterId    INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    FilePath     NVARCHAR(400) NOT NULL,
    FileName     NVARCHAR(260) NOT NULL,
    FileSize     INT NOT NULL,
    ContentType  NVARCHAR(100) NULL,
    UploadedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ConsumedDate DATETIME2 NULL
);
GO

/* dbo.ExpenseAttachment never captured the file's content type, so a receipt attached to
   an already-created expense had no way to be streamed back with the right Content-Type.
   usp_Expense_Create is updated to copy ContentType across from the staged row at claim
   time (a permanent record — the file's own MIME type does not change) alongside a new
   usp_ExpenseAttachment_GetForDownload proc that lets an already-attached receipt be
   viewed through the expense that owns it, scoped by the expense's own chapter — closing
   the gap the frontend agent found and correctly declined to paper over (there is no
   general-purpose /api/attachments/{attachmentStagingId} route for an ExpenseAttachment's
   own id — that id space belongs to a different table). */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseAttachment') AND name = 'ContentType')
    ALTER TABLE dbo.ExpenseAttachment ADD ContentType NVARCHAR(100) NULL;
GO

/* ---- Indexes for the reads that actually happen. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Expense_Chapter_Date')
    CREATE INDEX IX_Expense_Chapter_Date ON dbo.Expense(ChapterId, ExpenseDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Donation_Chapter_Date')
    CREATE INDEX IX_Donation_Chapter_Date ON dbo.Donation(ChapterId, DonationDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Activity_Chapter')
    CREATE INDEX IX_Activity_Chapter ON dbo.Activity(ChapterId);
/* Keeps the future unclaimed-staging sweep (a later devops task, not this one) cheap —
   a filtered index over only the still-staged rows. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AttachmentStaging_Unconsumed')
    CREATE INDEX IX_AttachmentStaging_Unconsumed ON dbo.AttachmentStaging(ConsumedDate)
        WHERE ConsumedDate IS NULL;
GO
