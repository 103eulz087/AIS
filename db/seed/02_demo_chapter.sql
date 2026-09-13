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
