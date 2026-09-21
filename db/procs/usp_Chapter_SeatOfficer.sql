/* Seats one officer on @ChapterId's own office — the chapter-level mirror of
   usp_Council_SeatOfficer, but with a deliberately DIFFERENT authority split (client
   decision 2026-09-22):

     - Seating/replacing the PRESIDENT: authority comes from OUTSIDE the chapter — the
       nearest ancestor council with seated officers, walked from the chapter's own
       ParentCouncilId via usp_Approval_ResolveApprover (the exact same "nearest existing
       ancestor with seated officers" rule as everywhere else — §13a, no second
       mechanism). This is the one seat in a chapter that still gets an external check.
     - Seating/replacing any OTHER office (VP/Secretary/Treasurer/Auditor/Master
       Initiator I-III): authority is the chapter's OWN seated President (ChapterAdmin)
       — no council involvement. A properly-vetted President runs his own team; only the
       question of WHO becomes President gets checked from above.

   Unlike council seating, there is no "outside jurisdiction" branch here and no
   SeatOverride equivalent: a chapter officer must already be a MEMBER OF THIS CHAPTER
   (invariant #14 — a member's home is one chapter or one council, never neither) — the
   existing Charter/Turnover officer pickers already only ever offer that chapter's own
   roster (OfficerRoster.tsx's own GET /api/members, no chapterId, defaults to caller's
   own chapter), so this mirrors that, not a new rule.

   Deliberately does NOT issue an enrolment link — a chapter officer being seated this way
   is, by definition, already a member of the chapter (he joined through the ordinary
   sign-up/approval path first), so he either already has an account or the EXISTING
   "Resend enrolment link" action (POST /api/members/{id}/enrolment-link,
   ChapterRegistrationDetail.tsx / MemberDirectory.tsx) already covers getting him one —
   no second mechanism for that either. */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_SeatOfficer
    @RequestingMemberId INT,
    @ChapterId    INT,
    @MemberId     INT,
    @OfficeId     INT,
    @TermStart    DATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId AND IsActive = 1)
        THROW 51700, 'This chapter does not exist, or has gone dormant.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @PresidentOfficeId INT = (SELECT OfficeId FROM dbo.ChapterOffice WHERE OfficeName = 'President');

    IF @OfficeId = @PresidentOfficeId
    BEGIN
        DECLARE @ParentCouncilId INT = (SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterId);
        DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
        -- Swallowed into a throwaway table variable, never returned — a bare EXEC here
        -- would otherwise bubble its own SELECT up as an extra result set ahead of this
        -- proc's own (see usp_Council_ResolveSeatingAuthority's own header for exactly
        -- this bug, found live, in usp_Council_EligibleOfficers).
        DECLARE @Suppress TABLE (ActingCouncilId INT, CouncilName NVARCHAR(150), IntendedCouncilId INT, RoutingReason NVARCHAR(40));
        INSERT INTO @Suppress
        EXEC dbo.usp_Approval_ResolveApprover
            @ParentCouncilId = @ParentCouncilId,
            @ActingCouncilIdOut = @ActingCouncilId OUTPUT, @RoutingReasonOut = @RoutingReason OUTPUT;

        IF NOT EXISTS (
            SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
            WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
              AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        )
            THROW 51701, 'Only the council above this chapter may seat or replace its President.', 1;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
            WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Chapter' AND mr.ScopeId = @ChapterId
              AND r.RoleName = 'ChapterAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
        )
            THROW 51702, 'Only this chapter''s own President may seat or replace this officer.', 1;
    END

    DECLARE @HomeChapterId INT, @RenewedThrough DATE;
    SELECT @HomeChapterId = ChapterId, @RenewedThrough = RenewedThrough
    FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0;

    IF @HomeChapterId IS NULL
        THROW 51703, 'Member not found.', 1;

    IF @HomeChapterId <> @ChapterId
        THROW 51704, 'This brother belongs to a different chapter. A chapter''s officers must be members of that same chapter.', 1;

    IF @RenewedThrough IS NOT NULL AND @RenewedThrough < @Today
        THROW 51705, 'This brother''s renewal has lapsed. A lapsed member cannot be seated as an officer — renew him first, or choose someone else.', 1;

    DECLARE @RoleId INT;
    IF NOT EXISTS (SELECT 1 FROM dbo.ChapterOffice WHERE OfficeId = @OfficeId)
        THROW 51706, 'Unrecognized chapter office.', 1;
    SELECT @RoleId = RoleId FROM dbo.ChapterOffice WHERE OfficeId = @OfficeId;
    DECLARE @PlainMemberRoleId INT = (SELECT RoleId FROM dbo.Role WHERE RoleName = 'Member');

    IF EXISTS (
        SELECT 1 FROM dbo.MemberRole
        WHERE ScopeType = 'Chapter' AND ScopeId = @ChapterId AND OfficeId = @OfficeId AND TermEnd IS NULL
    )
        THROW 51707, 'This office is already held. Unseat the current officer before seating a replacement.', 1;

    DECLARE @MemberRoleId INT;
    BEGIN TRAN;
        INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, OfficeId, TermStart, TermEnd)
        VALUES (@MemberId, ISNULL(@RoleId, @PlainMemberRoleId), 'Chapter', @ChapterId, @OfficeId, @TermStart, NULL);
        SET @MemberRoleId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MemberRole', CAST(@MemberRoleId AS NVARCHAR(40)), 'ChapterSeat',
                CONCAT(N'{"ChapterId":', @ChapterId, N',"MemberId":', @MemberId, N',"OfficeId":', @OfficeId, N'}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @MemberRoleId AS MemberRoleId;
END
GO
