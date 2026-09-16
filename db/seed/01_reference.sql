SET NOCOUNT ON;
MERGE dbo.CouncilLevel AS t USING (VALUES
 ('International',1),('National',2),('Regional',3),('Provincial',4),('City/Municipal',5)
) AS s(LevelName,LevelOrder) ON t.LevelName = s.LevelName
WHEN NOT MATCHED THEN INSERT (LevelName,LevelOrder) VALUES (s.LevelName,s.LevelOrder);

MERGE dbo.MemberStatus AS t USING (VALUES
 ('Pending'),('Approved'),('Active'),('Inactive'),('Suspended'),('Rejected')
) AS s(StatusName) ON t.StatusName = s.StatusName
WHEN NOT MATCHED THEN INSERT (StatusName) VALUES (s.StatusName);

MERGE dbo.BloodType AS t USING (VALUES
 ('O+'),('O-'),('A+'),('A-'),('B+'),('B-'),('AB+'),('AB-')
) AS s(BloodTypeName) ON t.BloodTypeName = s.BloodTypeName
WHEN NOT MATCHED THEN INSERT (BloodTypeName) VALUES (s.BloodTypeName);

MERGE dbo.AttendanceStatus AS t USING (VALUES
 ('Present'),('Late'),('Excused'),('Absent')
) AS s(StatusName) ON t.StatusName = s.StatusName
WHEN NOT MATCHED THEN INSERT (StatusName) VALUES (s.StatusName);

/* Skills are a CONTROLLED list. Free text is not permitted — it destroys the filter. */
MERGE dbo.Skill AS t USING (VALUES
 ('Driver'),('Electrician'),('Welder'),('Carpenter'),('Mason'),('Plumber'),
 ('Nurse'),('First Aid'),('IT / Computer'),('Security'),('Mechanic'),('Teacher'),
 ('Heavy Equipment'),('Barber'),('Cook'),('Painter'),('Photography'),('Driver (Heavy Truck)')
) AS s(SkillName) ON t.SkillName = s.SkillName
WHEN NOT MATCHED THEN INSERT (SkillName) VALUES (s.SkillName);

/* ChapterAuditor (chapter-registration module): the Auditor office's role. Read-only —
   §7A.4 "An auditor who can edit what he audits is not an auditor." Must NEVER appear in
   any write-granting authorization policy anywhere in the codebase (backend's job to
   honour; noted here so the constraint travels with the role's own definition).

   CouncilAdmin (chapter-registration module, decision E1b): the council President's
   full-admin capability, seeded because no generic council "president/full admin" role
   existed before this module — CouncilSecretary already covered the verifier half of
   two-person control (Secretary verifies each officer; President gives final approval),
   but nothing covered the approver half. IsCouncilRole=1 like every other council role. */
MERGE dbo.Role AS t USING (VALUES
 ('Member',0),('ChapterOfficer',0),('ChapterTreasurer',0),('ChapterAdmin',0),('ChapterAuditor',0),
 ('CouncilSecretary',1),('CouncilTreasurer',1),('CouncilAdmin',1),('ProvincialOfficer',1),
 ('RegionalOfficer',1),('NationalSecretariat',1),('SystemAdmin',1)
) AS s(RoleName,IsCouncilRole) ON t.RoleName = s.RoleName
WHEN NOT MATCHED THEN INSERT (RoleName,IsCouncilRole) VALUES (s.RoleName,s.IsCouncilRole);

MERGE dbo.CorrectiveActionCategory AS t USING (VALUES
 ('Non-attendance'),('Conduct'),('Financial'),('Violation of by-laws'),('Other')
) AS s(CategoryName) ON t.CategoryName = s.CategoryName
WHEN NOT MATCHED THEN INSERT (CategoryName) VALUES (s.CategoryName);

/* Announcement.IsUrgent's structured type — see db/schema/08_comms_align.sql. */
MERGE dbo.UrgentType AS t USING (VALUES
 ('BloodRequest'),('Assistance')
) AS s(TypeName) ON t.TypeName = s.TypeName
WHEN NOT MATCHED THEN INSERT (TypeName) VALUES (s.TypeName);

/* Expense.CategoryId's controlled list — see db/schema/09_expenses_donations.sql. */
MERGE dbo.ExpenseCategory AS t USING (VALUES
 ('Food & Refreshments'),('Transport'),('Supplies'),('Venue'),
 ('Utilities'),('Donation Given'),('Council Remittance'),('Other')
) AS s(CategoryName) ON t.CategoryName = s.CategoryName
WHEN NOT MATCHED THEN INSERT (CategoryName) VALUES (s.CategoryName);

/* Donation.DonorTypeId's controlled list — kept alongside the existing free-text
   Donation.DonorType column. See db/schema/09_expenses_donations.sql. */
MERGE dbo.DonorType AS t USING (VALUES
 ('Government Official'),('Private'),('Business'),('Member')
) AS s(TypeName) ON t.TypeName = s.TypeName
WHEN NOT MATCHED THEN INSERT (TypeName) VALUES (s.TypeName);

/* MembershipApplication's own decision states — a SEPARATE concept from dbo.MemberStatus
   (which describes a MEMBER's renewal/standing, not an application's decision). See
   db/schema/10_membership_applications.sql design note 3. */
MERGE dbo.MembershipApplicationStatus AS t USING (VALUES
 ('PendingApproval'),('ReturnedForCorrection'),('Approved'),('Rejected')
) AS s(StatusName) ON t.StatusName = s.StatusName
WHEN NOT MATCHED THEN INSERT (StatusName) VALUES (s.StatusName);

/* dbo.ChapterRegistrationStatus — EXACTLY these three rows, forever. No 'Rejected' row:
   see db/schema/17_chapter_registration.sql's header for why this list is shorter than
   MembershipApplicationStatus's on purpose. */
MERGE dbo.ChapterRegistrationStatus AS t USING (VALUES
 ('Submitted'),('ReturnedForCorrection'),('Approved')
) AS s(StatusName) ON t.StatusName = s.StatusName
WHEN NOT MATCHED THEN INSERT (StatusName) VALUES (s.StatusName);

/* dbo.ChapterOffice — the eight offices of §7A.4's paper form, in form order.
   RoleId resolved BY NAME (never a literal id) per this codebase's own habit (see
   db/schema/10_membership_applications.sql design note 2). GrantsLogin=0 for the three
   Master Initiator seats only — "recorded office, no login" per §7A.4. */
MERGE dbo.ChapterOffice AS t USING (
    SELECT s.OfficeName, s.SortOrder, r.RoleId, s.GrantsLogin
    FROM (VALUES
        ('President',1,'ChapterAdmin',1),
        ('Vice President',2,'ChapterOfficer',1),
        ('Secretary',3,'ChapterOfficer',1),
        ('Treasurer',4,'ChapterTreasurer',1),
        ('Auditor',5,'ChapterAuditor',1),
        ('Master Initiator I',6,'Member',0),
        ('Master Initiator II',7,'Member',0),
        ('Master Initiator III',8,'Member',0)
    ) AS s(OfficeName,SortOrder,RoleName,GrantsLogin)
    JOIN dbo.Role r ON r.RoleName = s.RoleName
) AS s(OfficeName,SortOrder,RoleId,GrantsLogin) ON t.OfficeName = s.OfficeName
WHEN NOT MATCHED THEN INSERT (OfficeName,SortOrder,RoleId,GrantsLogin)
    VALUES (s.OfficeName,s.SortOrder,s.RoleId,s.GrantsLogin);

/* dbo.ChapterAccent — the six-colour approved palette (§7A.3, "not a colour picker").
   Brass and Slate reuse this app's own existing design tokens verbatim
   (src/web/src/shared/tokens.css: --brass / --slate); Forest, Maroon and Ochre reuse the
   same file's semantic accents (--in / --out / --warn) under names that read naturally
   as chapter colours rather than as status colours. Navy is the one genuinely new hex
   here, chosen to sit comfortably alongside the other five without clashing with --info
   (already used for informational UI, not decoration). */
MERGE dbo.ChapterAccent AS t USING (VALUES
 ('Brass',  '#C39A3E'),
 ('Slate',  '#39424F'),
 ('Forest', '#2E6B52'),
 ('Maroon', '#A6392E'),
 ('Navy',   '#1F3A5F'),
 ('Ochre',  '#B4801E')
) AS s(AccentName,HexValue) ON t.AccentName = s.AccentName
WHEN NOT MATCHED THEN INSERT (AccentName,HexValue) VALUES (s.AccentName,s.HexValue);
GO
