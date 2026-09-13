/* ============================================================================
   Council creation and seating.

   Two rules make this work, and they replace the provisional-seat idea entirely:

   1. A council may only be created once at least one registered chapter exists in
      its jurisdiction. Chapters come first; the council is constituted over them.
      This is also what guarantees the officer dropdown is never empty.

   2. Council officers are SELECTED, never encoded. The eligible list is members of
      chapters inside that council's subtree. Seating someone from outside is allowed
      — a province with one chapter cannot otherwise supply six officers — but it is
      recorded in dbo.SeatOverride with the name of whoever did it.
   ============================================================================ */

/* Populates the officer dropdown. This is the ONLY source of council officers. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_EligibleOfficers
    @CouncilId INT,
    @Search    NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    WITH CouncilTree AS (
        SELECT CouncilId FROM dbo.Council WHERE CouncilId = @CouncilId
        UNION ALL
        SELECT c.CouncilId FROM dbo.Council c
        JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
    )
    SELECT  m.MemberId, m.GiftName, m.MemberNumber,
            m.FirstName + ' ' + m.LastName AS FullName,
            ch.ChapterId, ch.ChapterName, m.RenewedThrough,
            /* A council officer who has himself lapsed would be approving other
               people's renewals while breaking the same rule. Surfaced, not hidden. */
            CASE WHEN m.RenewedThrough >= CAST(SYSUTCDATETIME() AS DATE)
                 THEN 1 ELSE 0 END AS IsCurrent
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

CREATE OR ALTER PROCEDURE dbo.usp_Council_Create
    @RequestingMemberId INT,
    @ParentCouncilId INT,
    @CouncilLevelId  INT,
    @CouncilName     NVARCHAR(150)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Council WHERE CouncilId = @ParentCouncilId)
        THROW 51080, 'The parent council does not exist. The chain is built downward.', 1;

    /* Rule 1. Without a chapter beneath it the officer dropdown would be empty,
       and a council with no chapters governs nothing anyway. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.Chapter ch
        JOIN dbo.Member m ON m.ChapterId = ch.ChapterId AND m.IsDeleted = 0
        JOIN dbo.MemberStatus ms ON ms.StatusId = m.StatusId AND ms.StatusName IN ('Approved','Active')
        WHERE ch.ParentCouncilId = @ParentCouncilId)
        THROW 51081, 'No registered chapter with members exists in this jurisdiction yet. Register a chapter first — the parent council approves it in the meantime.', 1;

    BEGIN TRAN;
        INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName)
        VALUES (@ParentCouncilId, @CouncilLevelId, @CouncilName);
        DECLARE @NewId INT = SCOPE_IDENTITY();
    COMMIT;

    SELECT @NewId AS CouncilId;
END
GO

/* Seats one officer. Records a SeatOverride when he is from outside the jurisdiction. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_SeatOfficer
    @RequestingMemberId INT,
    @CouncilId  INT,
    @MemberId   INT,
    @RoleId     INT,
    @TermStart  DATE,
    @TermEnd    DATE,
    @OutsideJurisdictionReason NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @HomeChapterId INT, @InJurisdiction BIT = 0;
    SELECT @HomeChapterId = ChapterId FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0;
    IF @HomeChapterId IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId)
        THROW 51082, 'Member not found. A council cannot create one — a chapter must.', 1;

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
        THROW 51083, 'This brother is not from a chapter in this jurisdiction. Seating him is permitted, but a reason is required and it is recorded permanently.', 1;

    BEGIN TRAN;
        INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
        VALUES (@MemberId, @RoleId, 'Council', @CouncilId, @TermStart, @TermEnd);
        DECLARE @MemberRoleId INT = SCOPE_IDENTITY();

        IF @InJurisdiction = 0
            INSERT dbo.SeatOverride (MemberRoleId, CouncilId, MemberId, HomeChapterId,
                                     SeatedBy, Reason)
            VALUES (@MemberRoleId, @CouncilId, @MemberId, @HomeChapterId,
                    @RequestingMemberId, @OutsideJurisdictionReason);
    COMMIT;

    SELECT @MemberRoleId AS MemberRoleId, @InJurisdiction AS WasInJurisdiction;
END
GO
