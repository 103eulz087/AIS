/* ============================================================================
   Council creation and seating — council-registration module.

   REWRITE NOTICE (2026-09-21): the original version of every procedure in this file
   accepted @RequestingMemberId but never checked it for any standing whatsoever — an
   audit finding, not a live incident, since nothing in the app has ever called these
   (CLAUDE.md §8.9's own "no UI or API yet"). This rewrite is what makes it safe to put
   a UI on top of them. See each procedure's own header for what changed.

   Two rules still make this work:

   1. A council may only be created once at least one registered chapter exists in
      its jurisdiction. Chapters come first; the council is constituted over them.

   2. Council officers are SELECTED, never encoded. The eligible list is members of
      chapters inside that council's subtree. Seating someone from outside is allowed
      — a province with one chapter cannot otherwise supply six officers — but it is
      recorded in dbo.SeatOverride with the name of whoever did it.

   NEW rule this rewrite adds:

   3. Who may act on council X — create a child under it, seat/replace/unseat an
      officer on it — is resolved by usp_Council_ResolveSeatingAuthority: the nearest
      existing ancestor with seated officers (invariant #13a, the same rule chapter-
      registration approval already uses), or X itself if X is the root (National
      seats National). Never re-derive this walk inline; always delegate to that proc.
   ============================================================================ */

/* Populates the officer-candidate picker for @CouncilId. This is the ONLY source of
   in-jurisdiction council officer candidates.

   REWRITE: added @RequestingMemberId, checked against the same seating authority
   usp_Council_SeatOfficer itself requires — browsing candidates is gated the same as
   acting on them, so this proc can never become the unscoped cross-chapter member
   lookup 1c's finding warned about. IsCurrent is now CAST(...AS BIT) (CLAUDE.md §8.7 —
   a bare CASE WHEN...THEN 1 ELSE 0 END infers INT and 500s Dapper's bool binding with
   no client-visible detail, live in usp_ChapterRegistration_GetQueue's own CanAct
   column once already). */
CREATE OR ALTER PROCEDURE dbo.usp_Council_EligibleOfficers
    @RequestingMemberId INT,
    @CouncilId INT,
    @Search    NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    EXEC dbo.usp_Council_ResolveSeatingAuthority
        @CouncilId = @CouncilId, @ActingCouncilId = @ActingCouncilId OUTPUT, @RoutingReason = @RoutingReason OUTPUT;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51650, 'Only the council that may seat this council''s officers may browse candidates for it.', 1;

    WITH CouncilTree AS (
        SELECT CouncilId FROM dbo.Council WHERE CouncilId = @CouncilId
        UNION ALL
        SELECT c.CouncilId FROM dbo.Council c
        JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
    )
    SELECT  m.MemberId, m.GiftName, m.MemberNumber,
            m.FirstName + ' ' + m.LastName AS FullName,
            ch.ChapterId, ch.ChapterName, m.RenewedThrough,
            CAST(CASE WHEN m.RenewedThrough IS NOT NULL AND m.RenewedThrough >= @Today
                      THEN 1 ELSE 0 END AS BIT) AS IsCurrent,
            CAST(CASE WHEN m.RenewedThrough IS NOT NULL AND m.RenewedThrough < @Today
                      THEN 1 ELSE 0 END AS BIT) AS IsLapsed,
            CAST(CASE WHEN m.MobileNo IS NULL OR LTRIM(RTRIM(m.MobileNo)) = ''
                      THEN 1 ELSE 0 END AS BIT) AS NoMobileNumber
    FROM    dbo.Member m
            JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId
    WHERE   ch.ParentCouncilId IN (SELECT CouncilId FROM CouncilTree)
      AND   m.IsDeleted = 0
      AND   ms.StatusName IN ('Approved','Active')
      AND   (@Search IS NULL OR m.GiftName LIKE '%' + @Search + '%'
                             OR m.LastName LIKE '%' + @Search + '%')
    ORDER BY m.GiftName
    OPTION (MAXRECURSION 20);
END
GO

/* A single, scoped, anti-enumeration lookup for an OUT-OF-jurisdiction nominee — by
   exact member number only, never a browsable/searchable list (invariant #7: cross-
   chapter member data is name, chapter and status only; this proc returns exactly that
   shape and nothing else). Same authority gate as usp_Council_EligibleOfficers. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_MemberLookup
    @RequestingMemberId INT,
    @CouncilId     INT,
    @MemberNumber  NVARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    EXEC dbo.usp_Council_ResolveSeatingAuthority
        @CouncilId = @CouncilId, @ActingCouncilId = @ActingCouncilId OUTPUT, @RoutingReason = @RoutingReason OUTPUT;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51651, 'Only the council that may seat this council''s officers may look up a member by number.', 1;

    SELECT  m.MemberId, m.GiftName, m.MemberNumber, ch.ChapterName, ms.StatusName,
            m.RenewedThrough,
            CAST(CASE WHEN m.RenewedThrough IS NOT NULL AND m.RenewedThrough >= @Today
                      THEN 1 ELSE 0 END AS BIT) AS IsCurrent,
            CAST(CASE WHEN m.RenewedThrough IS NOT NULL AND m.RenewedThrough < @Today
                      THEN 1 ELSE 0 END AS BIT) AS IsLapsed,
            CAST(CASE WHEN m.MobileNo IS NULL OR LTRIM(RTRIM(m.MobileNo)) = ''
                      THEN 1 ELSE 0 END AS BIT) AS NoMobileNumber
    FROM    dbo.Member m
            LEFT JOIN dbo.Chapter ch ON ch.ChapterId = m.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId
    WHERE   m.MemberNumber = @MemberNumber
      AND   m.IsDeleted = 0
      AND   ms.StatusName IN ('Approved','Active');
END
GO

/* Creates (or returns the existing) council for exactly one geography level — a
   Regional council for @RegionId, a Provincial council for @ProvinceId, or a City
   council for @MunicipalityId (exactly one supplied). Mostly a residual-case tool:
   usp_ChapterRegistration_Approve already auto-creates any missing council chain the
   moment a chapter registers into it, so this proc is for a jurisdiction that needs a
   council BEFORE its first chapter is approved, or one seeded before auto-creation
   shipped. Not touched or refactored here — it keeps working exactly as before.

   REWRITE fixes (1a's four findings): (1) @RequestingMemberId now checked against
   usp_Council_ResolveSeatingAuthority for @ParentCouncilId — creation is authorized the
   same way seating on the new council's own future officers will be. (2) An AuditLog
   row is written inside the transaction (invariant #10). (3) The geography column
   matching the requested level is always set, so usp_Council_ResolveJurisdiction and
   usp_Chapter_ListPublic can see the new council immediately. (4) Dedup by geography —
   if a council already exists for the given Region/Province/Municipality, its own id is
   returned rather than creating a second, permanent, undeletable duplicate (#15). Level
   order is validated against the parent (#12: a body cannot be registered above its own
   parent's level). */
CREATE OR ALTER PROCEDURE dbo.usp_Council_Create
    @RequestingMemberId INT,
    @ParentCouncilId INT,
    @CouncilName     NVARCHAR(150),
    @RegionId        INT = NULL,
    @ProvinceId      INT = NULL,
    @MunicipalityId  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF (CASE WHEN @RegionId IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN @ProvinceId IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN @MunicipalityId IS NOT NULL THEN 1 ELSE 0 END) <> 1
        THROW 51660, 'Give exactly one of RegionId, ProvinceId or MunicipalityId — the level this council will be created at.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @ParentCouncilId)
        THROW 51661, 'The parent council does not exist. The chain is built downward.', 1;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    EXEC dbo.usp_Council_ResolveSeatingAuthority
        @CouncilId = @ParentCouncilId, @ActingCouncilId = @ActingCouncilId OUTPUT, @RoutingReason = @RoutingReason OUTPUT;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51662, 'Only the council that may seat officers on this parent may create a council beneath it.', 1;

    DECLARE @ParentLevelOrder INT = (
        SELECT cl.LevelOrder FROM dbo.Council c JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
        WHERE c.CouncilId = @ParentCouncilId);

    DECLARE @TargetLevelName NVARCHAR(50) =
        CASE WHEN @RegionId IS NOT NULL THEN 'Regional'
             WHEN @ProvinceId IS NOT NULL THEN 'Provincial'
             ELSE 'City/Municipal' END;
    DECLARE @TargetLevelId INT, @TargetLevelOrder INT;
    SELECT @TargetLevelId = CouncilLevelId, @TargetLevelOrder = LevelOrder
    FROM dbo.CouncilLevel WHERE LevelName = @TargetLevelName;

    IF @TargetLevelOrder <> @ParentLevelOrder + 1
        THROW 51663, 'A council can only be created directly beneath the level above it — pick the correct parent for this level.', 1;

    -- Dedup by geography — return the existing council rather than a second one (#15).
    DECLARE @ExistingId INT = (
        SELECT CouncilId FROM dbo.Council
        WHERE  (@RegionId IS NOT NULL AND RegionId = @RegionId)
            OR (@ProvinceId IS NOT NULL AND ProvinceId = @ProvinceId)
            OR (@MunicipalityId IS NOT NULL AND MunicipalityId = @MunicipalityId));
    IF @ExistingId IS NOT NULL
    BEGIN
        SELECT @ExistingId AS CouncilId, CAST(0 AS BIT) AS WasCreated;
        RETURN;
    END

    IF NOT EXISTS (
        SELECT 1 FROM dbo.Chapter ch
        JOIN dbo.Member m ON m.ChapterId = ch.ChapterId AND m.IsDeleted = 0
        JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId AND ms.StatusName IN ('Approved','Active')
        WHERE (@RegionId IS NOT NULL AND ch.ParentCouncilId IN (
                    SELECT CouncilId FROM dbo.Council WHERE RegionId = @RegionId OR ParentCouncilId = @ParentCouncilId))
           OR (@ProvinceId IS NOT NULL AND ch.ParentCouncilId IN (
                    SELECT CouncilId FROM dbo.Council WHERE ProvinceId = @ProvinceId OR ParentCouncilId = @ParentCouncilId))
           OR (@MunicipalityId IS NOT NULL AND ch.ParentCouncilId = @ParentCouncilId))
        THROW 51664, 'No registered chapter with members exists in this jurisdiction yet. Register a chapter first — the parent council approves it in the meantime.', 1;

    DECLARE @NewId INT;
    BEGIN TRAN;
        INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName, RegionId, ProvinceId, MunicipalityId)
        VALUES (@ParentCouncilId, @TargetLevelId, @CouncilName, @RegionId, @ProvinceId, @MunicipalityId);
        SET @NewId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Council', CAST(@NewId AS NVARCHAR(40)), 'Create',
                CONCAT(N'{"ParentCouncilId":', @ParentCouncilId, N',"CouncilName":"', REPLACE(@CouncilName, '"', ''''), N'"}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @NewId AS CouncilId, CAST(1 AS BIT) AS WasCreated;
END
GO

/* Seats one officer on @CouncilId's own office (never a raw RoleId — see
   dbo.CouncilOffice's own header for why). Records a SeatOverride when he is from
   outside the jurisdiction, exactly as before. Issues his very first enrolment link in
   the same transaction if he has no account yet and has never redeemed one — a seated
   officer with no way to sign in is not seated in any useful sense, and this is the
   exact same first-credential-only bound usp_Enrolment_Issue's branch 2 already
   enforces, only now also reachable via a council seating its own new officer (see that
   proc's own updated header for the widened, still-bounded ancestor set).

   REWRITE (1b's findings, all four): (1) @RequestingMemberId checked against
   usp_Council_ResolveSeatingAuthority. (2) AuditLog row written. (3) @CouncilId must
   exist and be active — a Dissolved council can no longer be seated. (4) At most one
   LIVE holder per (council, office) — rejected here with a clear message before the
   filtered unique index (UX_MemberRole_CouncilOffice_Live) would reject it as a raw
   constraint violation; replacing an officer is always an explicit unseat-then-seat,
   never an implicit overwrite. Renewal check added (client decision 2026-09-21): a
   lapsed nominee (RenewedThrough set and in the past) cannot be seated; a nominee who
   has never had a renewal season run for him yet (RenewedThrough NULL) can — otherwise
   nobody could ever be seated at go-live, since founding officers start with no
   renewal history. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_SeatOfficer
    @RequestingMemberId INT,
    @CouncilId        INT,
    @MemberId         INT,
    @CouncilOfficeId  INT,
    @TermStart        DATE,
    @TermEnd          DATE = NULL,
    @OutsideJurisdictionReason NVARCHAR(300) = NULL,
    @TokenHash        VARBINARY(32) = NULL,   -- only used if the nominee needs his first link
    @ExpiresOn        DATETIME2 = NULL,
    @LinkId           INT = NULL OUTPUT,
    @ExpiresOnOut     DATETIME2 = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @CouncilId AND IsActive = 1)
        THROW 51670, 'This council does not exist, or has been dissolved.', 1;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    EXEC dbo.usp_Council_ResolveSeatingAuthority
        @CouncilId = @CouncilId, @ActingCouncilId = @ActingCouncilId OUTPUT, @RoutingReason = @RoutingReason OUTPUT;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51671, 'Only the council above this one (or National, if none is seated) may seat or replace an officer here.', 1;

    DECLARE @HomeChapterId INT, @RenewedThrough DATE, @MobileNo NVARCHAR(30);
    SELECT @HomeChapterId = ChapterId, @RenewedThrough = RenewedThrough, @MobileNo = MobileNo
    FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0;
    IF @HomeChapterId IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51672, 'Member not found. A council cannot create one — a chapter must.', 1;

    DECLARE @RoleId INT;
    SELECT @RoleId = RoleId FROM dbo.CouncilOffice WHERE CouncilOfficeId = @CouncilOfficeId;
    IF @RoleId IS NULL
        THROW 51673, 'Unrecognized council office.', 1;

    IF EXISTS (
        SELECT 1 FROM dbo.MemberRole
        WHERE ScopeType = 'Council' AND ScopeId = @CouncilId AND CouncilOfficeId = @CouncilOfficeId
          AND TermEnd IS NULL
    )
        THROW 51674, 'This office is already held. Unseat the current officer before seating a replacement.', 1;

    IF @RenewedThrough IS NOT NULL AND @RenewedThrough < @Today
        THROW 51676, 'This brother''s renewal has lapsed. A lapsed officer cannot be seated — renew him first, or choose someone else.', 1;

    DECLARE @InJurisdiction BIT = 0;
    WITH CouncilTree AS (
        SELECT CouncilId FROM dbo.Council WHERE CouncilId = @CouncilId
        UNION ALL
        SELECT c.CouncilId FROM dbo.Council c JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
    )
    SELECT @InJurisdiction = 1
    FROM dbo.Chapter ch WHERE ch.ChapterId = @HomeChapterId
      AND ch.ParentCouncilId IN (SELECT CouncilId FROM CouncilTree)
    OPTION (MAXRECURSION 20);

    IF @InJurisdiction = 0 AND (@OutsideJurisdictionReason IS NULL
                                OR LTRIM(RTRIM(@OutsideJurisdictionReason)) = '')
        THROW 51675, 'This brother is not from a chapter in this jurisdiction. Seating him is permitted, but a reason is required and it is recorded permanently.', 1;

    DECLARE @MemberRoleId INT;
    DECLARE @NewLinkId INT, @NewExpiresOn DATETIME2;

    BEGIN TRAN;
        INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, CouncilOfficeId, TermStart, TermEnd)
        VALUES (@MemberId, @RoleId, 'Council', @CouncilId, @CouncilOfficeId, @TermStart, @TermEnd);
        SET @MemberRoleId = SCOPE_IDENTITY();

        IF @InJurisdiction = 0
            INSERT dbo.SeatOverride (MemberRoleId, CouncilId, MemberId, HomeChapterId,
                                     SeatedBy, Reason)
            VALUES (@MemberRoleId, @CouncilId, @MemberId, @HomeChapterId,
                    @RequestingMemberId, @OutsideJurisdictionReason);

        INSERT dbo.ApprovalRouting (SubjectType, SubjectId, IntendedCouncilId, ActingCouncilId, RoutingReason, ActorMemberId)
        VALUES ('CouncilSeat', @MemberRoleId, @CouncilId, @ActingCouncilId, @RoutingReason, @RequestingMemberId);

        -- First credential only, same bound as every other issuer of a first link:
        -- no account yet, never redeemed one. usp_Enrolment_Issue re-derives this from
        -- @MemberId itself — never trusted from here — and simply no-ops (THROWs, caught
        -- and swallowed below only for the "not his first credential" case) rather than
        -- blocking the seat itself: a seat is valid even if he already has a working
        -- login from elsewhere.
        IF @TokenHash IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.UserAccount WHERE MemberId = @MemberId)
           AND NOT EXISTS (SELECT 1 FROM dbo.EnrolmentLink WHERE MemberId = @MemberId AND RedeemedOn IS NOT NULL)
           AND @MobileNo IS NOT NULL AND LTRIM(RTRIM(@MobileNo)) <> ''
        BEGIN
            EXEC dbo.usp_Enrolment_Issue
                @MemberId = @MemberId, @IssuedBy = @RequestingMemberId, @TokenHash = @TokenHash,
                @ExpiresOn = @ExpiresOn, @LinkId = @NewLinkId OUTPUT, @ExpiresOnOut = @NewExpiresOn OUTPUT;
        END

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MemberRole', CAST(@MemberRoleId AS NVARCHAR(40)), 'CouncilSeat',
                CONCAT(N'{"CouncilId":', @CouncilId, N',"MemberId":', @MemberId,
                       N',"CouncilOfficeId":', @CouncilOfficeId, N',"InJurisdiction":', @InJurisdiction, N'}'),
                @RequestingMemberId);
    COMMIT;

    SET @LinkId = @NewLinkId;
    SET @ExpiresOnOut = @NewExpiresOn;

    SELECT @MemberRoleId AS MemberRoleId, @InJurisdiction AS WasInJurisdiction,
           @NewLinkId AS LinkId, @NewExpiresOn AS ExpiresOn;
END
GO

/* Unseats an officer — sets TermEnd, never deletes (invariant #15's own logic extended
   to MemberRole: nothing in this codebase is ever removed, only closed out — same
   pattern usp_ChapterRegistration_Approve's Turnover branch already uses for a chapter's
   own officers). Any dbo.SeatOverride row for this seat is left exactly as it is — it is
   a permanent historical record of who was seated and why, not a description of a
   current state, and it must never be touched by an unseat. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_UnseatOfficer
    @RequestingMemberId INT,
    @MemberRoleId INT,
    @Reason       NVARCHAR(300)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51680, 'A reason is required.', 1;

    DECLARE @CouncilId INT, @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    SELECT @CouncilId = ScopeId
    FROM dbo.MemberRole
    WHERE MemberRoleId = @MemberRoleId AND ScopeType = 'Council'
      AND (TermEnd IS NULL OR TermEnd >= @Today);
    IF @CouncilId IS NULL
        THROW 51681, 'This seat was not found, or has already ended.', 1;

    DECLARE @ActingCouncilId INT, @RoutingReason NVARCHAR(40);
    EXEC dbo.usp_Council_ResolveSeatingAuthority
        @CouncilId = @CouncilId, @ActingCouncilId = @ActingCouncilId OUTPUT, @RoutingReason = @RoutingReason OUTPUT;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Council' AND mr.ScopeId = @ActingCouncilId
          AND r.RoleName = 'CouncilAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51682, 'Only the council above this one (or National, if none is seated) may unseat an officer here.', 1;

    BEGIN TRAN;
        UPDATE dbo.MemberRole SET TermEnd = @Today WHERE MemberRoleId = @MemberRoleId;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('MemberRole', CAST(@MemberRoleId AS NVARCHAR(40)), 'CouncilUnseat',
                CONCAT(N'{"Reason":"', REPLACE(@Reason, '"', ''''), N'"}'), @RequestingMemberId);
    COMMIT;
END
GO
