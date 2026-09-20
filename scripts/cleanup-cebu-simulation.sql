/* ============================================================================
   DEV/STAGING TEST-DATA CLEANUP — the KAPPA GAMMA (Cebu City) chapter-registration
   simulation run during dev testing on the shared corex.itcoreapps.com/AISDB
   database (CLAUDE.md §10).

   DO NOT run this against a database that has ever held a REAL "KAPPA GAMMA"
   chapter, or a real Region VII / Cebu Provincial / Cebu City council. It matches
   rows BY NAME, not by a "test data" flag (this schema has none), so it is only
   as safe as those names actually being the dev-test rows created on
   2026-09-16..19. Read the SELECTs this script prints before letting the DELETEs
   run — that is what the PRINT / row-count checks below are for.

   This intentionally undoes ONLY the Cebu chapter-registration simulation:
     - the KAPPA GAMMA chapter, its 8 founding-officer Member rows, their
       MemberRole / UserAccount / EnrolmentLink / RefreshToken rows
     - the ChapterRegistration (Charter) row and its Officer/Update/Routing rows
     - the Region VII / Cebu Provincial / Cebu City Council rows created to
       route and hold it

   It deliberately leaves ALONE everything that is standing environment setup,
   not simulation debris:
     - National Council and whichever member(s) are seated on it (CLAUDE.md §8.9
       — council seating has no UI yet; re-seating it is a separate, deliberate
       step, not something this script should ever silently redo or undo)
     - the seeded Laguna demo chain (Region IV-A CALABARZON / Laguna Provincial
       Council / Sta. Rosa City Council) and Brgy. San Isidro Chapter
     - dbo.AuditLog — append-only, CLAUDE.md invariant #10. This script never
       touches it, and does not need to: AuditLog carries no FK to Member/
       Chapter/Council, so nothing here is blocked by, or removes, an audit
       trail. The audit rows for this test run simply stay, referencing
       now-deleted ids — same as any legitimate append-only history would after
       the entities it describes are gone.

   Safe to re-run: every DELETE is scoped by a name lookup that returns nothing
   the second time. Wrapped in one transaction — if anything looks wrong, it is
   all-or-nothing. ============================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ChapterId INT = (SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = 'KAPPA GAMMA');
DECLARE @RegistrationId INT = (SELECT RegistrationId FROM dbo.ChapterRegistration WHERE ProposedChapterName = 'KAPPA GAMMA');
DECLARE @CityCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'Cebu City Council');
DECLARE @ProvinceCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'Cebu Provincial Council');
DECLARE @RegionCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'Region VII Council');

PRINT '--- What this run found ---';
PRINT 'ChapterId (KAPPA GAMMA): ' + ISNULL(CAST(@ChapterId AS NVARCHAR(20)), '<none — already clean>');
PRINT 'RegistrationId: ' + ISNULL(CAST(@RegistrationId AS NVARCHAR(20)), '<none>');
PRINT 'Cebu City Council: ' + ISNULL(CAST(@CityCouncilId AS NVARCHAR(20)), '<none>');
PRINT 'Cebu Provincial Council: ' + ISNULL(CAST(@ProvinceCouncilId AS NVARCHAR(20)), '<none>');
PRINT 'Region VII Council: ' + ISNULL(CAST(@RegionCouncilId AS NVARCHAR(20)), '<none>');

IF @ChapterId IS NULL AND @RegistrationId IS NULL AND @CityCouncilId IS NULL
BEGIN
    PRINT 'Nothing to clean up — already in a clean state.';
    RETURN;
END

DECLARE @MemberIds TABLE (MemberId INT PRIMARY KEY);
INSERT INTO @MemberIds (MemberId) SELECT MemberId FROM dbo.Member WHERE ChapterId = @ChapterId;

DECLARE @AccountIds TABLE (AccountId INT PRIMARY KEY);
INSERT INTO @AccountIds (AccountId) SELECT AccountId FROM dbo.UserAccount WHERE MemberId IN (SELECT MemberId FROM @MemberIds);

PRINT '--- Members to remove ---';
SELECT MemberId, MemberNumber, GiftName FROM dbo.Member WHERE MemberId IN (SELECT MemberId FROM @MemberIds);

/* Preflight: every table with a live FK to dbo.Member(MemberId) that still has a row
   pointing at one of these members, found by walking sys.foreign_keys rather than by
   hand — the hand-picked DELETEs below already missed MemberCredential, ScanLog and
   AttachmentStaging once each. Two rows with the SAME table name below are two
   different columns (e.g. VerifiedBy and CreatedMemberId) — both matter.

   This is deliberately print-only, not a blind delete-everything-found: some of these
   tables are invariant-protected and must NEVER be deleted from, even here —
   CorrectiveAction (CLAUDE.md #2, never deleted), AckReceipt (#3, never deleted, no
   exception for sysadmin), AuditLog (#10, append-only). If any of those show a
   nonzero count, STOP — these founding officers were involved in something with a
   real compliance record, and that needs a human decision, not another DELETE line
   added to this script. Everything else that shows up is very likely fine to add a
   scoped DELETE for, the same way the three tables above already were, but read what
   it actually is first. */
IF OBJECT_ID('tempdb..#MemberIds') IS NOT NULL DROP TABLE #MemberIds;
CREATE TABLE #MemberIds (MemberId INT PRIMARY KEY);
INSERT INTO #MemberIds (MemberId) SELECT MemberId FROM @MemberIds;

DECLARE @preflightSql NVARCHAR(MAX) = N'';
SELECT @preflightSql = @preflightSql + N'
IF EXISTS (SELECT 1 FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' WHERE ' + QUOTENAME(c.name) + N' IN (SELECT MemberId FROM #MemberIds))
    PRINT ''  ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N'.' + QUOTENAME(c.name) + N': '' + CAST((SELECT COUNT(*) FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' WHERE ' + QUOTENAME(c.name) + N' IN (SELECT MemberId FROM #MemberIds)) AS NVARCHAR(20)) + N'' row(s) — table not yet handled by this script'';'
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables t ON t.object_id = fkc.parent_object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
WHERE rt.name = 'Member' AND rt.schema_id = SCHEMA_ID('dbo')
  -- tables this script (as of this run) already deletes from before deleting Member
  AND NOT (s.name = 'dbo' AND t.name IN ('EnrolmentLink', 'MemberRole', 'ChapterRegistrationOfficer',
      'ChapterRegistrationUpdate', 'MemberCredential', 'ScanLog', 'AttachmentStaging'));

PRINT '--- Other tables still referencing these members (beyond what this script deletes) ---';
EXEC sp_executesql @preflightSql;
PRINT '--- If nothing printed above, the DELETEs below should run clean. ---';

DROP TABLE #MemberIds;

BEGIN TRAN;

    -- Sessions and push subscriptions for those accounts.
    DELETE FROM dbo.RefreshToken WHERE AccountId IN (SELECT AccountId FROM @AccountIds);
    DELETE FROM dbo.PushSubscription WHERE AccountId IN (SELECT AccountId FROM @AccountIds);
    DELETE FROM dbo.UserAccount WHERE AccountId IN (SELECT AccountId FROM @AccountIds);
    DELETE FROM dbo.EnrolmentLink WHERE MemberId IN (SELECT MemberId FROM @MemberIds);
    DELETE FROM dbo.MemberRole WHERE MemberId IN (SELECT MemberId FROM @MemberIds);

    -- The registration itself: officer seats, status history, routing record.
    DELETE FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @RegistrationId;
    DELETE FROM dbo.ChapterRegistrationUpdate WHERE RegistrationId = @RegistrationId;
    DELETE FROM dbo.ApprovalRouting WHERE SubjectType = 'Chapter' AND SubjectId = @RegistrationId;
    DELETE FROM dbo.ChapterRegistration WHERE RegistrationId = @RegistrationId;

    -- QR credentials issued to those officers (and any scans of them), any files they
    -- staged for upload (photo/attachment picked but never claimed by an expense or
    -- profile save), then the 8 founding officers, then the chapter itself.
    DELETE FROM dbo.ScanLog WHERE CredentialId IN (SELECT CredentialId FROM dbo.MemberCredential WHERE MemberId IN (SELECT MemberId FROM @MemberIds));
    DELETE FROM dbo.ScanLog WHERE ScannedByMemberId IN (SELECT MemberId FROM @MemberIds);
    DELETE FROM dbo.MemberCredential WHERE MemberId IN (SELECT MemberId FROM @MemberIds);
    DELETE FROM dbo.AttachmentStaging WHERE UploadedBy IN (SELECT MemberId FROM @MemberIds);
    DELETE FROM dbo.Member WHERE MemberId IN (SELECT MemberId FROM @MemberIds);
    DELETE FROM dbo.Chapter WHERE ChapterId = @ChapterId;

    -- The council chain, child before parent.
    DELETE FROM dbo.Council WHERE CouncilId = @CityCouncilId;
    DELETE FROM dbo.Council WHERE CouncilId = @ProvinceCouncilId;
    DELETE FROM dbo.Council WHERE CouncilId = @RegionCouncilId;

COMMIT;

PRINT 'Cebu simulation data removed. National Council, its seated officer(s), and the Laguna demo chain were left untouched.';
