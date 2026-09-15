/* A member reading his OWN record. This is a THIRD read shape, distinct from both branches
   of usp_Member_Search (same-chapter / cross-chapter): a member reading himself gets fields
   neither of those branches ever return to anyone else — Address, Email, DateSurvive,
   PresidentDuringSurvive, MasterInitiatorDuringSurvive, SeconderMemberId, ApprovedBy/Date,
   BloodTypeConfirmedDate — because CLAUDE.md invariant #7 / docs Decision 2 restrict what
   OTHER members see of him, never what he sees of himself.

   No @MemberId parameter, by design (CLAUDE.md invariant #4 / #11) — there is nothing here
   for a caller to tamper into viewing somebody else's profile. @RequestingMemberId comes
   from the JWT and IS the row being read; there is no alternate branch that takes a
   different id.

   LEFT JOIN dbo.Chapter and LEFT JOIN dbo.Council: CK_Member_Home (02_members.sql) means
   exactly one of ChapterId / HomeCouncilId is set. A detached/council-attached member
   (invariant #14) has NULL ChapterId, so an INNER JOIN to Chapter would silently return an
   empty result set for him — the same bug class docs §7A.6 calls out for
   usp_Council_AttachedMembers. Both joins are LEFT so his own profile resolves either way. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_GetOwnProfile
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0)
        THROW 51240, 'Member not found.', 1;

    -- Result set 1: the full self-profile.
    SELECT  m.MemberId,
            m.MemberNumber,
            m.FirstName, m.MiddleName, m.LastName, m.GiftName,
            m.Birthdate,
            m.DateSurvive, m.PresidentDuringSurvive, m.MasterInitiatorDuringSurvive,
            m.ChapterId, ch.ChapterName,
            m.HomeCouncilId, co.CouncilName,
            m.ChapterOfRecord,
            m.StatusId, ms.StatusName,
            m.RenewedThrough,
            m.SeconderMemberId, m.ApprovedBy, m.ApprovedDate,
            m.Address,
            m.BloodTypeId, bt.BloodTypeName, m.BloodTypeConfirmedDate,
            m.Profession,
            m.PhotoPath, m.PhotoContentType,
            m.MobileNo, m.Email,
            m.RowVersion
    FROM    dbo.Member m
            LEFT JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
            LEFT JOIN dbo.Council co      ON co.CouncilId = m.HomeCouncilId
            JOIN      dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
            LEFT JOIN dbo.BloodType bt    ON bt.BloodTypeId = m.BloodTypeId
    WHERE   m.MemberId = @RequestingMemberId;

    -- Result set 2: his current skill ids.
    SELECT SkillId
    FROM   dbo.MemberSkill
    WHERE  MemberId = @RequestingMemberId;
END
GO
