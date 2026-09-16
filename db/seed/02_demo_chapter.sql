/* A demo council chain and chapter so the app is usable on first run.
   Safe to run repeatedly. Do NOT deploy to production. */
SET NOCOUNT ON;
DECLARE @National INT, @Region INT, @Province INT, @City INT, @ChapterId INT;

IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = 'National Council')
INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName)
SELECT NULL, CouncilLevelId, 'National Council' FROM dbo.CouncilLevel WHERE LevelName='National';
SELECT @National = CouncilId FROM dbo.Council WHERE CouncilName='National Council';

IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = 'Region IV-A CALABARZON')
INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName)
SELECT @National, CouncilLevelId, 'Region IV-A CALABARZON' FROM dbo.CouncilLevel WHERE LevelName='Regional';
SELECT @Region = CouncilId FROM dbo.Council WHERE CouncilName='Region IV-A CALABARZON';

IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = 'Laguna Provincial Council')
INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName)
SELECT @Region, CouncilLevelId, 'Laguna Provincial Council' FROM dbo.CouncilLevel WHERE LevelName='Provincial';
SELECT @Province = CouncilId FROM dbo.Council WHERE CouncilName='Laguna Provincial Council';

IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilName = 'Sta. Rosa City Council')
INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName)
SELECT @Province, CouncilLevelId, 'Sta. Rosa City Council' FROM dbo.CouncilLevel WHERE LevelName='City/Municipal';
SELECT @City = CouncilId FROM dbo.Council WHERE CouncilName='Sta. Rosa City Council';

/* Geography for the three sub-national demo councils (db/schema/17_chapter_registration.sql
   added Council.RegionId/ProvinceId/MunicipalityId; existing councils are deliberately NOT
   backfilled by that schema file — this is that one-time data-entry, but for demo data only).
   National keeps all three NULL by that same file's design (it has no geography of its own).
   Matched by NAME against the real PH geography rows seeded by db/seed/05_ph_geography.sql
   (db/schema/16_geography.sql), never by a guessed literal id — the source dataset names the
   region 'Region 4A' rather than 'CALABARZON', which is why the demo council's own display
   name keeps the familiar 'CALABARZON' label while the match below goes by the geography
   table's own spelling. Idempotent: reruns simply set the same values again. */
UPDATE c
   SET c.RegionId = g.RegionId
FROM   dbo.Council c
       CROSS JOIN (SELECT TOP (1) RegionId FROM dbo.Region WHERE RegionName = 'Region 4A') g
WHERE  c.CouncilName = 'Region IV-A CALABARZON' AND c.RegionId IS NULL;

UPDATE c
   SET c.ProvinceId = g.ProvinceId
FROM   dbo.Council c
       CROSS JOIN (SELECT TOP (1) ProvinceId FROM dbo.Province WHERE ProvinceName = 'Laguna') g
WHERE  c.CouncilName = 'Laguna Provincial Council' AND c.ProvinceId IS NULL;

UPDATE c
   SET c.MunicipalityId = g.MunicipalityId
FROM   dbo.Council c
       CROSS JOIN (
           SELECT TOP (1) m.MunicipalityId
           FROM   dbo.Municipality m
                  JOIN dbo.Province p ON p.ProvinceId = m.ProvinceId
           WHERE  m.MunicipalityName = 'Santa Rosa' AND p.ProvinceName = 'Laguna'
       ) g
WHERE  c.CouncilName = 'Sta. Rosa City Council' AND c.MunicipalityId IS NULL;

IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterName = 'Brgy. San Isidro Chapter')
INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, DateChartered, SuggestedContribution)
VALUES (@City, 'Brgy. San Isidro Chapter', 'San Isidro', '2005-08-09', 300.00);
SELECT @ChapterId = ChapterId FROM dbo.Chapter WHERE ChapterName='Brgy. San Isidro Chapter';

DECLARE @Active INT = (SELECT StatusId FROM dbo.MemberStatus WHERE StatusName='Active');

MERGE dbo.Member AS t USING (VALUES
 ('AKR-04-0117-001','Ramon','C','Delgado','TANGLAW','O+','Electrician','2011-03-19'),
 ('AKR-04-0117-002','Joel','R','Mariano','BAGWIS','A+','Registered Nurse','2013-08-02'),
 ('AKR-04-0117-003','Arnel','S','Bautista','LAKANDULA','O-','Heavy Equipment Operator','2009-12-06'),
 ('AKR-04-0117-004','Dennis','L','Portugal','HIMAGSIK','B+','Carpenter','2016-05-21'),
 ('AKR-04-0117-005','Rey','O','Fabian','AGOS','O+','Barangay Tanod','2019-10-05')
) AS s(MemberNumber,FirstName,MiddleName,LastName,GiftName,Blood,Profession,DateSurvive)
ON t.MemberNumber = s.MemberNumber
WHEN NOT MATCHED THEN
INSERT (ChapterId,MemberNumber,FirstName,MiddleName,LastName,GiftName,BloodTypeId,
        Profession,DateSurvive,StatusId,RenewedThrough)
VALUES (@ChapterId, s.MemberNumber, s.FirstName, s.MiddleName, s.LastName, s.GiftName,
        (SELECT BloodTypeId FROM dbo.BloodType WHERE BloodTypeName = s.Blood),
        s.Profession, s.DateSurvive, @Active, '2027-08-08');
GO

/* A mobile number is mandatory for every officer — it's how his enrolment link
   reaches him. No password/token/hash is ever seeded; enrolment is always redeemed
   by the officer himself. */
UPDATE dbo.Member
   SET MobileNo = '09171234567'
 WHERE MemberNumber = 'AKR-04-0117-001'
   AND MobileNo IS NULL;

/* TANGLAW is seated as Chapter Admin for the demo chapter, per the officer roster
   in §7A.4 — the President is the first account the chapter receives.
   @ChapterId does not survive the batch above, so it is re-resolved here. */
DECLARE @DemoChapterId INT = (SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = 'Brgy. San Isidro Chapter');

IF NOT EXISTS (
    SELECT 1
    FROM   dbo.MemberRole mr
           JOIN dbo.Member m ON m.MemberId = mr.MemberId
           JOIN dbo.Role   r ON r.RoleId = mr.RoleId
    WHERE  m.MemberNumber = 'AKR-04-0117-001'
      AND  r.RoleName = 'ChapterAdmin'
      AND  mr.ScopeType = 'Chapter'
      AND  mr.ScopeId = @DemoChapterId
)
INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
SELECT m.MemberId, r.RoleId, 'Chapter', @DemoChapterId, '2025-08-09', NULL
FROM   dbo.Member m, dbo.Role r
WHERE  m.MemberNumber = 'AKR-04-0117-001'
  AND  r.RoleName = 'ChapterAdmin';
GO

/* Without at least one council seated with officers, usp_Approval_ResolveApprover
   (db/procs/usp_Approval_Routing.sql) can never find an ancestor to approve anything —
   it walks up from the intended council looking for one with seated officers and THROWs
   51090 if it reaches the top of the tree with nobody seated anywhere. Seat the
   City/Municipal demo council (Sta. Rosa) only — it is the one that actually receives
   chapter-charter applications filed against this demo geography (Santa Rosa, Laguna).
   National is deliberately left unseated here: per docs/AIS-Project-Documentation.md
   §7A.6, National's bootstrap is a separate install-script concern, not seed data — and
   this module correctly DEPENDS on a real approver existing above it, which seeding
   National here would quietly mask.

   HIMAGSIK (AKR-04-0117-004) and AGOS (AKR-04-0117-005) are used — two DIFFERENT
   existing demo members, neither of them TANGLAW (already the chapter's ChapterAdmin).
   Deliberately NOT BAGWIS (AKR-04-0117-002) or LAKANDULA (AKR-04-0117-003): several
   xUnit fixtures (EnrolmentIssueScopeTests, ChatModuleIntegrationTests,
   ChatPrivacyAndScopeLeakTests) rely on those two specific members staying an ordinary,
   role-less chapter member and a never-an-officer member respectively, to prove a
   negative ("an ordinary member may NOT issue a link for a fellow member"). Seating
   either of them with a Council-scoped role — even on a different council than any
   those tests reason about — makes BAGWIS a legitimate "bounded council issuer" under
   usp_Enrolment_Issue's Branch 2 for any not-yet-enrolled member of THIS demo chapter
   (its own ParentCouncilId walks straight up to the council just seated), which flips
   that assertion from a THROW to a success. Confirmed by running dotnet test before and
   after picking 004/005 instead of 002/003. Decision E1b: CouncilAdmin is the council
   President's full-admin/approval capability; CouncilSecretary verifies each officer.
   Both terms are open-ended (TermStart = today, TermEnd = NULL), matching every other
   seed role in this file. */
DECLARE @DemoCouncilId INT = (SELECT CouncilId FROM dbo.Council WHERE CouncilName = 'Sta. Rosa City Council');
DECLARE @SeatToday DATE = CAST(SYSUTCDATETIME() AS DATE);

IF NOT EXISTS (
    SELECT 1
    FROM   dbo.MemberRole mr
           JOIN dbo.Member m ON m.MemberId = mr.MemberId
           JOIN dbo.Role   r ON r.RoleId = mr.RoleId
    WHERE  m.MemberNumber = 'AKR-04-0117-004'
      AND  r.RoleName = 'CouncilAdmin'
      AND  mr.ScopeType = 'Council'
      AND  mr.ScopeId = @DemoCouncilId
)
INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
SELECT m.MemberId, r.RoleId, 'Council', @DemoCouncilId, @SeatToday, NULL
FROM   dbo.Member m, dbo.Role r
WHERE  m.MemberNumber = 'AKR-04-0117-004'
  AND  r.RoleName = 'CouncilAdmin';

IF NOT EXISTS (
    SELECT 1
    FROM   dbo.MemberRole mr
           JOIN dbo.Member m ON m.MemberId = mr.MemberId
           JOIN dbo.Role   r ON r.RoleId = mr.RoleId
    WHERE  m.MemberNumber = 'AKR-04-0117-005'
      AND  r.RoleName = 'CouncilSecretary'
      AND  mr.ScopeType = 'Council'
      AND  mr.ScopeId = @DemoCouncilId
)
INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
SELECT m.MemberId, r.RoleId, 'Council', @DemoCouncilId, @SeatToday, NULL
FROM   dbo.Member m, dbo.Role r
WHERE  m.MemberNumber = 'AKR-04-0117-005'
  AND  r.RoleName = 'CouncilSecretary';
GO

/* One PendingApproval membership application against the demo chapter, so the approval
   queue has something to show on first run. The applicant is deliberately NOT one of the
   5 seeded members above (a distinct name and gift name), so nobody mistakes an applicant
   for a member. His named seconder is TANGLAW (AKR-04-0117-001) given as free text, exactly
   as a real applicant would type it — SeconderMemberId is left NULL on purpose, so a
   chapter admin reviewing this in dev sees the genuine "not yet confirmed" state, not a
   pre-resolved one. Idempotent by ReferenceNo.

   The ReferenceNo below is a hardcoded literal, not drawn from dbo.MembershipApplicationSeq
   — usp_MembershipApplication_Submit draws from that same sequence starting at 1, which
   would otherwise collide with this seeded 'APP-2026-00001' the first time anyone submits
   a real application in a freshly seeded dev database. The NEXT VALUE FOR call just below
   reserves sequence value 1 to match, so the next real submission gets 'APP-2026-00002'
   onward. Wrapped in the same IF NOT EXISTS so it only ever fires once.

   @DemoChapterId does not survive the GO above either — re-resolved again here. */
DECLARE @DemoChapterId INT = (SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = 'Brgy. San Isidro Chapter');

IF NOT EXISTS (SELECT 1 FROM dbo.MembershipApplication WHERE ReferenceNo = 'APP-2026-00001')
BEGIN
    DECLARE @SeedApplicationSeq INT = NEXT VALUE FOR dbo.MembershipApplicationSeq;

    INSERT dbo.MembershipApplication (
        ReferenceNo, ChapterId, FirstName, MiddleName, LastName, GiftName, BirthDate,
        MobileNo, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
        SeconderNameGiven, SeconderMemberNumberGiven, StatusId, IsOpen)
    SELECT 'APP-2026-00001', @DemoChapterId, 'Michael', 'D', 'Santos', 'SIGLAHI', '1998-04-12',
           '09209876543', 'michael.santos@example.com', '2024-11-09', 'Ramon Delgado', 'Arnel Bautista',
           'TANGLAW', 'AKR-04-0117-001',
           (SELECT StatusId FROM dbo.MembershipApplicationStatus WHERE StatusName = 'PendingApproval'), 1;
END
GO
