/* One registration, in full, for a council officer reviewing it. Same anti-enumeration
   shape as usp_MembershipApplication_Get: a nonexistent registration id and a
   registration acting at some OTHER council this caller has no standing over come back
   with the exact same "not found" error, so this cannot be used to probe which
   registration ids exist under a council this caller does not oversee.

   "Has standing over" here means: seated on the registration's ActingCouncilId itself,
   OR on any ANCESTOR of it (a provincial officer may always look at what its city
   councils are deciding — the read-only half of the queue's own visibility rule,
   applied to a single item). Walked UP via Council.ParentCouncilId, the mirror image of
   usp_Council_GetSubtree's own downward walk.

   Four result sets:
     1. The registration header.
     2. Its eight officers, in office order, each with its verification state and its
        resolved identity (COALESCE over the Member row for a Turnover seat, or the
        typed-in columns for a Charter seat — never both populated, by
        CK_ChapterRegistrationOfficer_Person).
     3. Its own status-change history, oldest first.
     4. Its routing record (dbo.ApprovalRouting), if one exists. */
CREATE OR ALTER PROCEDURE dbo.usp_ChapterRegistration_Get
    @RegistrationId INT,
    @RequestingMemberId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @ActingCouncilId INT;

    SELECT @ActingCouncilId = ActingCouncilId FROM dbo.ChapterRegistration WHERE RegistrationId = @RegistrationId;

    IF @ActingCouncilId IS NULL
        THROW 51530, 'Registration not found.', 1;

    DECLARE @AncestorCouncils TABLE (CouncilId INT PRIMARY KEY);
    ;WITH AncestorTree AS (
        SELECT CouncilId, ParentCouncilId FROM dbo.Council WHERE CouncilId = @ActingCouncilId
        UNION ALL
        SELECT c.CouncilId, c.ParentCouncilId
        FROM   dbo.Council c JOIN AncestorTree a ON c.CouncilId = a.ParentCouncilId
    )
    INSERT INTO @AncestorCouncils (CouncilId)
    SELECT CouncilId FROM AncestorTree
    OPTION (MAXRECURSION 20);

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council'
          AND  mr.ScopeId  IN (SELECT CouncilId FROM @AncestorCouncils)
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51530, 'Registration not found.', 1;

    -- 1. The registration header. ChapterName resolves via COALESCE(ChapterId,
    --    CreatedChapterId) — a Charter row's own ChapterId is NULL forever (it didn't
    --    exist at filing); CreatedChapterId is where an approved Charter's chapter lives.
    SELECT  cr.RegistrationId, cr.ReferenceNo, cr.RegistrationType, cr.ChapterId, ch.ChapterName,
            cr.ProposedChapterName, cr.Barangay, cr.RegionId, cr.ProvinceId, cr.MunicipalityId,
            cr.MarkAccentId, ca.AccentName, ca.HexValue,
            cr.IntendedCouncilId, ic.CouncilName AS IntendedCouncilName,
            cr.ActingCouncilId, ac.CouncilName AS ActingCouncilName, cr.RoutingReason,
            cr.SubmittedByMemberId, sm.GiftName AS SubmittedByGiftName,
            cr.SubmittedDate, cr.StatusId, s.StatusName, cr.IsOpen,
            cr.DecidedBy, db.GiftName AS DecidedByGiftName, cr.DecidedDate, cr.DecisionReason,
            cr.CreatedChapterId
    FROM    dbo.ChapterRegistration cr
            JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
            JOIN dbo.Council ac ON ac.CouncilId = cr.ActingCouncilId
            LEFT JOIN dbo.Council ic ON ic.CouncilId = cr.IntendedCouncilId
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = COALESCE(cr.ChapterId, cr.CreatedChapterId)
            LEFT JOIN dbo.ChapterAccent ca ON ca.AccentId = cr.MarkAccentId
            LEFT JOIN dbo.Member sm ON sm.MemberId = cr.SubmittedByMemberId
            LEFT JOIN dbo.Member db ON db.MemberId = cr.DecidedBy
    WHERE   cr.RegistrationId = @RegistrationId;

    -- 2. The eight officers, in office order, with verification state and resolved identity.
    SELECT  o.RegistrationOfficerId, o.OfficeId, co.OfficeName, co.SortOrder, co.GrantsLogin,
            o.MemberId, m.MemberNumber,
            COALESCE(m.FirstName, o.FirstName) AS FirstName,
            COALESCE(m.MiddleName, o.MiddleName) AS MiddleName,
            COALESCE(m.LastName, o.LastName) AS LastName,
            COALESCE(m.GiftName, o.GiftName) AS GiftName,
            COALESCE(m.Birthdate, o.BirthDate) AS BirthDate,
            COALESCE(m.MobileNo, o.MobileNo) AS MobileNo,
            COALESCE(m.Email, o.Email) AS Email,
            COALESCE(m.DateSurvive, o.DateSurvive) AS DateSurvive,
            COALESCE(m.PresidentDuringSurvive, o.PresidentDuringSurvive) AS PresidentDuringSurvive,
            COALESCE(m.MasterInitiatorDuringSurvive, o.MasterInitiatorDuringSurvive) AS MasterInitiatorDuringSurvive,
            o.VerifiedBy, vb.GiftName AS VerifiedByGiftName, o.VerifiedDate, o.VerifyNote,
            o.CreatedMemberId
    FROM    dbo.ChapterRegistrationOfficer o
            JOIN dbo.ChapterOffice co ON co.OfficeId = o.OfficeId
            LEFT JOIN dbo.Member m  ON m.MemberId  = o.MemberId
            LEFT JOIN dbo.Member vb ON vb.MemberId = o.VerifiedBy
    WHERE   o.RegistrationId = @RegistrationId
    ORDER BY co.SortOrder;

    -- 3. Status-change history, oldest first.
    SELECT  u.ChapterRegistrationUpdateId, u.UpdateDate, u.UpdatedBy, u.StatusId, s.StatusName, u.Notes
    FROM    dbo.ChapterRegistrationUpdate u
            JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = u.StatusId
    WHERE   u.RegistrationId = @RegistrationId
    ORDER BY u.UpdateDate ASC, u.ChapterRegistrationUpdateId ASC;

    -- 4. The routing record.
    SELECT  ar.RoutingId, ar.IntendedCouncilId, ar.ActingCouncilId, ar.RoutingReason,
            ar.ActorMemberId, ar.ActedOn, ar.Remarks
    FROM    dbo.ApprovalRouting ar
    WHERE   ar.SubjectType = 'Chapter' AND ar.SubjectId = @RegistrationId;
END
GO
