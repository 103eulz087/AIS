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

MERGE dbo.Role AS t USING (VALUES
 ('Member',0),('ChapterOfficer',0),('ChapterTreasurer',0),('ChapterAdmin',0),
 ('CouncilSecretary',1),('CouncilTreasurer',1),('ProvincialOfficer',1),
 ('RegionalOfficer',1),('NationalSecretariat',1),('SystemAdmin',1)
) AS s(RoleName,IsCouncilRole) ON t.RoleName = s.RoleName
WHEN NOT MATCHED THEN INSERT (RoleName,IsCouncilRole) VALUES (s.RoleName,s.IsCouncilRole);

MERGE dbo.CorrectiveActionCategory AS t USING (VALUES
 ('Non-attendance'),('Conduct'),('Financial'),('Violation of by-laws'),('Other')
) AS s(CategoryName) ON t.CategoryName = s.CategoryName
WHEN NOT MATCHED THEN INSERT (CategoryName) VALUES (s.CategoryName);
GO
