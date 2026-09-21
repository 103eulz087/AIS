/* Lets a Chapter Admin correct a same-chapter member's FirstName/MiddleName/LastName/
   MobileNo — the four organizational-identity fields usp_Member_UpdateOwnProfile's own
   guardrail deliberately keeps OFF self-service ("editable only by an officer, through
   a future module — never by the member himself, never from this procedure"). This is
   that module. Typo correction only, ChapterAdmin, same chapter — never MemberNumber,
   ChapterId, StatusId or any other scoping-relevant column (still forbidden here for
   the exact same reason usp_Member_UpdateOwnProfile's own header gives).

   MobileNo shares usp_Member_UpdateOwnProfile's own rules exactly: required, cannot be
   blanked, unique across dbo.Member, and a CHANGE invalidates any outstanding
   unredeemed enrolment link (its MobileNoAtIssue snapshot goes stale).

   Concurrency: @RowVersion is the value the caller loaded with usp_Member_Search's own
   same-chapter row (RowVersion now rides along there for exactly this reason) — the
   UPDATE's own WHERE clause carries the match, same "check inside the statement"
   posture as usp_Member_UpdateOwnProfile. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_UpdateByOfficer
    @RequestingMemberId INT,
    @MemberId    INT,
    @FirstName   NVARCHAR(60),
    @MiddleName  NVARCHAR(60) = NULL,
    @LastName    NVARCHAR(60),
    @MobileNo    NVARCHAR(30),
    @RowVersion  BINARY(8)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @FirstName IS NULL OR LTRIM(RTRIM(@FirstName)) = ''
        THROW 51260, 'A first name is required.', 1;
    IF @LastName IS NULL OR LTRIM(RTRIM(@LastName)) = ''
        THROW 51261, 'A last name is required.', 1;
    IF @MobileNo IS NULL OR LTRIM(RTRIM(@MobileNo)) = ''
        THROW 51262, 'A mobile number is required. It cannot be blanked once set.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    DECLARE @RequesterChapterId INT;
    SELECT @RequesterChapterId = ChapterId FROM dbo.Member WHERE MemberId = @RequestingMemberId AND IsDeleted = 0;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole mr JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE mr.MemberId = @RequestingMemberId AND mr.ScopeType = 'Chapter' AND mr.ScopeId = @RequesterChapterId
          AND r.RoleName = 'ChapterAdmin' AND mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
    )
        THROW 51263, 'Only this chapter''s own President may edit a member''s name or mobile number.', 1;

    DECLARE @TargetChapterId INT;
    SELECT @TargetChapterId = ChapterId FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0;

    IF @TargetChapterId IS NULL
        THROW 51264, 'Member not found.', 1;

    IF @TargetChapterId <> @RequesterChapterId
        THROW 51265, 'This brother belongs to a different chapter.', 1;

    IF EXISTS (
        SELECT 1 FROM dbo.Member WHERE MobileNo = @MobileNo AND MemberId <> @MemberId AND IsDeleted = 0
    )
        THROW 51266, 'That mobile number is already registered to another member. Each member needs his own.', 1;

    DECLARE @OldFirstName NVARCHAR(60), @OldMiddleName NVARCHAR(60), @OldLastName NVARCHAR(60), @OldMobileNo NVARCHAR(30);
    SELECT @OldFirstName = FirstName, @OldMiddleName = MiddleName, @OldLastName = LastName, @OldMobileNo = MobileNo
    FROM   dbo.Member WHERE MemberId = @MemberId;

    DECLARE @NewRowVersion BINARY(8);
    DECLARE @NewRowVersionTable TABLE (RowVersion BINARY(8));

    BEGIN TRAN;
        -- The RowVersion match in the WHERE clause IS the concurrency guard.
        UPDATE dbo.Member
           SET FirstName  = @FirstName,
               MiddleName = @MiddleName,
               LastName   = @LastName,
               MobileNo   = @MobileNo
        OUTPUT inserted.RowVersion INTO @NewRowVersionTable(RowVersion)
         WHERE MemberId = @MemberId AND RowVersion = @RowVersion;

        IF @@ROWCOUNT = 0
            THROW 51267, 'This member''s record changed since you loaded it. Refresh and try again.', 1;

        SELECT @NewRowVersion = RowVersion FROM @NewRowVersionTable;

        IF (@OldMobileNo IS NULL OR @OldMobileNo <> @MobileNo)
        BEGIN
            UPDATE dbo.EnrolmentLink
               SET InvalidatedOn = SYSUTCDATETIME(),
                   InvalidatedReason = N'Mobile number changed'
             WHERE MemberId = @MemberId
               AND RedeemedOn IS NULL
               AND InvalidatedOn IS NULL;
        END

        INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
        VALUES ('Member', CAST(@MemberId AS NVARCHAR(40)), 'UpdateByOfficer',
                CONCAT(N'{"FirstName":"', REPLACE(ISNULL(@OldFirstName, N''), '"', ''''),
                       N'","MiddleName":"', REPLACE(ISNULL(@OldMiddleName, N''), '"', ''''),
                       N'","LastName":"', REPLACE(ISNULL(@OldLastName, N''), '"', ''''),
                       N'","MobileNo":"', ISNULL(@OldMobileNo, N''), N'"}'),
                CONCAT(N'{"FirstName":"', REPLACE(@FirstName, '"', ''''),
                       N'","MiddleName":"', REPLACE(ISNULL(@MiddleName, N''), '"', ''''),
                       N'","LastName":"', REPLACE(@LastName, '"', ''''),
                       N'","MobileNo":"', @MobileNo, N'"}'),
                @RequestingMemberId);
    COMMIT;

    SELECT @NewRowVersion AS RowVersion;
END
GO
