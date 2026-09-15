/* 12 — Corrective actions (discipline module) hardening.

   db/schema/04_discipline_comms.sql already created dbo.CorrectiveAction,
   dbo.CorrectiveActionCategory, dbo.CorrectiveActionUpdate and
   TR_CorrectiveAction_NoDelete (CLAUDE.md invariant #2). This file closes the gaps
   found when the discipline module itself was built:

   1. dbo.CorrectiveActionUpdate had NO no-delete trigger. It is the append-only
      history log a case's status changes are read from (CLAUDE.md invariant #2 —
      "amendments append to CorrectiveActionUpdate"), so it needs the same structural
      guarantee LedgerEntry has, not just convention. Unlike CorrectiveAction (delete
      only — see TR_CorrectiveAction_NoDelete), a CorrectiveActionUpdate row is never
      edited either: a correction is a NEW row, never a rewrite of an old one. So this
      table gets the LedgerEntry-style INSTEAD OF UPDATE, DELETE trigger (see
      TR_LedgerEntry_NoUpdateDelete in 03_meetings_money.sql), not the
      CorrectiveAction-style DELETE-only one.

   2. FiledBy / UpdatedBy were bare INT with no FK to dbo.Member. Added below,
      idempotent via sys.foreign_keys guards.

   3. StatusName on both tables was an unchecked NVARCHAR(20). The four canonical
      values are confirmed by db/schema/04_discipline_comms.sql's own column comment
      and docs/AIS-Project-Documentation.md §4.5: Pending, Under Review, Reconciled,
      Dismissed. A CHECK constraint gets the same integrity a lookup table would,
      without the bigger migration — see CLAUDE.md decision for this module.

   4. CreatedDate — DateFiled is a DATE (the calendar day the case concerns), not a
      timestamp of when the row was actually inserted. Added CreatedDate DATETIME2
      for that, plus a RowVersion concurrency token, matching this repo's other
      write-table idioms.

   5. IX_CorrectiveAction_Chapter_Filed for usp_CorrectiveAction_GetByChapter's
      newest-first paged list.

   All idempotent — IF OBJECT_ID / sys.columns / sys.foreign_keys / sys.check_constraints
   guards, matching db/schema/11_member_profile.sql's style. */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CorrectiveAction') AND name = 'CreatedDate')
    ALTER TABLE dbo.CorrectiveAction ADD CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CorrectiveAction') AND name = 'RowVersion')
    ALTER TABLE dbo.CorrectiveAction ADD RowVersion ROWVERSION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CorrectiveAction_FiledBy')
    ALTER TABLE dbo.CorrectiveAction WITH CHECK
    ADD CONSTRAINT FK_CorrectiveAction_FiledBy FOREIGN KEY (FiledBy) REFERENCES dbo.Member(MemberId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CorrectiveActionUpdate_UpdatedBy')
    ALTER TABLE dbo.CorrectiveActionUpdate WITH CHECK
    ADD CONSTRAINT FK_CorrectiveActionUpdate_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Member(MemberId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CorrectiveAction_Status')
    ALTER TABLE dbo.CorrectiveAction WITH CHECK
    ADD CONSTRAINT CK_CorrectiveAction_Status
        CHECK (StatusName IN ('Pending', 'Under Review', 'Reconciled', 'Dismissed'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CorrectiveActionUpdate_Status')
    ALTER TABLE dbo.CorrectiveActionUpdate WITH CHECK
    ADD CONSTRAINT CK_CorrectiveActionUpdate_Status
        CHECK (StatusName IN ('Pending', 'Under Review', 'Reconciled', 'Dismissed'));
GO

/* Closes the real, currently-open gap: nothing today stops a DELETE against
   CorrectiveActionUpdate. A history log is also never rewritten in place, so both
   halves are blocked — mirrors TR_LedgerEntry_NoUpdateDelete exactly. */
CREATE OR ALTER TRIGGER dbo.TR_CorrectiveActionUpdate_NoUpdateDelete
ON dbo.CorrectiveActionUpdate INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51248, 'CorrectiveActionUpdate is an append-only history log. Add a new update instead.', 1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CorrectiveAction_Chapter_Filed')
    CREATE INDEX IX_CorrectiveAction_Chapter_Filed ON dbo.CorrectiveAction(ChapterId, DateFiled DESC);
GO
