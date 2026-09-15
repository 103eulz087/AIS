/* 11 — Member self-service profile. A member views his own full record and edits a
   specific subset himself; everything organizational/historical (name, gift name, member
   number, chapter, status, renewal, seconder, approval) stays read-only here, editable
   only by an officer through a future module. See CLAUDE.md §2 invariants #4, #7, #10,
   #11, #14 and docs §3.1 / §7.2 / §8.

   Two column changes, both additive and idempotent (sys.columns guard, same idiom as
   08_comms_align.sql / 09_expenses_donations.sql):

   1. BloodTypeConfirmedDate — the self-report timestamp paired with dbo.Member.BloodTypeId.
      Blood type here is ALWAYS self-reported, NEVER independently verified (docs §8) — this
      column exists so the client can show "self-reported, confirmed <date>" and never a
      tick or verified badge. Stamped or left alone by usp_Member_UpdateOwnProfile's own
      logic (see that proc's header comment); this file only adds the column.

   2. PhotoContentType — dbo.Member.PhotoPath (already on the table) has never had a paired
      content-type column, the same gap 09_expenses_donations.sql found and closed for
      dbo.ExpenseAttachment. A member's own photo upload (usp_Member_SetPhoto) copies the
      staged file's ContentType across at claim time, exactly as usp_Expense_Create does
      from dbo.AttachmentStaging — so usp_Member_GetPhoto can serve the file back with the
      right Content-Type instead of guessing from the extension. */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Member') AND name = 'BloodTypeConfirmedDate')
    ALTER TABLE dbo.Member ADD BloodTypeConfirmedDate DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Member') AND name = 'PhotoContentType')
    ALTER TABLE dbo.Member ADD PhotoContentType NVARCHAR(100) NULL;
GO
