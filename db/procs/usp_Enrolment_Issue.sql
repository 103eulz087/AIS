/* Issues a one-time, 72-hour enrolment link for a member who holds a role in the chapter —
   an officer at the time this was first written, and (since membership self-registration
   shipped) an ordinary newly-approved Member too. Never issues a password — see CLAUDE.md
   §2 invariant 16 / decision 18. The caller (backend) generates the raw token and its
   hash; this proc only ever sees the hash, and hands back the LinkId the caller needs to
   build the URL.

   @LinkId / @ExpiresOnOut OUTPUT let a caller already inside its own transaction (e.g.
   usp_MembershipApplication_Approve) capture the result directly, without an INSERT...EXEC
   workaround. The trailing SELECT below is UNCHANGED in shape so EnrolmentRepository (which
   reads it via Dapper) needs no change; it simply duplicates what the OUTPUT params now
   also carry. */
CREATE OR ALTER PROCEDURE dbo.usp_Enrolment_Issue
    @MemberId  INT,
    @IssuedBy  INT,
    @TokenHash VARBINARY(32),
    @ExpiresOn DATETIME2 = NULL,     -- defaults to 72 hours from now
    @LinkId    INT = NULL OUTPUT,
    @ExpiresOnOut DATETIME2 = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @MobileNo NVARCHAR(30);
    SELECT @MobileNo = MobileNo
    FROM   dbo.Member
    WHERE  MemberId = @MemberId AND IsDeleted = 0;

    IF @MobileNo IS NULL
        THROW 51100, 'Member not found, or has no mobile number on file. A member with no number cannot be given access.', 1;

    /* Deliberately ANY currently-active role, not a specific one — this is what lets a
       plain, newly-approved Member and a seated officer share this same proc with no
       branch between them. Do not narrow this to officer roles; that would break
       usp_MembershipApplication_Approve, which relies on exactly this check accepting
       the ordinary 'Member' role it assigns immediately beforehand, in the same
       transaction. */
    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF NOT EXISTS (
        SELECT 1 FROM dbo.MemberRole
        WHERE  MemberId = @MemberId
          AND  TermStart <= @Today
          AND  (TermEnd IS NULL OR TermEnd >= @Today)
    )
        THROW 51101, 'Member does not currently hold any role in this chapter. Approval must assign a role before an enrolment link can be issued.', 1;

    IF @ExpiresOn IS NULL SET @ExpiresOn = DATEADD(HOUR, 72, SYSUTCDATETIME());

    DECLARE @NewLinkId INT;

    BEGIN TRAN;
        /* Invalidate any outstanding link for this member before issuing a new one —
           there is never more than one live link per officer. */
        UPDATE dbo.EnrolmentLink
           SET InvalidatedOn = SYSUTCDATETIME(),
               InvalidatedReason = N'Superseded by a new enrolment link'
         WHERE MemberId = @MemberId
           AND RedeemedOn IS NULL
           AND InvalidatedOn IS NULL;

        INSERT dbo.EnrolmentLink (MemberId, TokenHash, MobileNoAtIssue, IssuedBy, ExpiresOn)
        VALUES (@MemberId, @TokenHash, @MobileNo, @IssuedBy, @ExpiresOn);

        SET @NewLinkId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('EnrolmentLink', CAST(@NewLinkId AS NVARCHAR(40)), 'Issue',
                CONCAT(N'{"MemberId":', @MemberId, N',"ExpiresOn":"',
                       CONVERT(NVARCHAR(30), @ExpiresOn, 126), N'"}'),
                @IssuedBy);
    COMMIT;

    SET @LinkId = @NewLinkId;
    SET @ExpiresOnOut = @ExpiresOn;

    SELECT @NewLinkId AS LinkId, @ExpiresOn AS ExpiresOn;
END
GO
