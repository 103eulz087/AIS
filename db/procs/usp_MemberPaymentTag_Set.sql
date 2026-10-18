/* Tags a member Paid, Free, or Unpaid for a membership year — National Council Admin
   only (client decision 2026-09-29, held at National alone while chapters are still
   rolling out). Tri-state as of 2026-10-06: 'Free' is for members given free membership
   for the year — it suppresses the Digital ID's "NOT YET PAID" watermark exactly like
   Paid does (see usp_Credential_GetOrIssueForSelf's own IsPaid formula), but is tracked
   as its own distinct state for the Payment Tags screen and the Paid/Free/Unpaid report
   (usp_MemberPaymentTag_GetStats) — "free" and "actually paid" are different facts worth
   telling apart there, even though a member's own card doesn't need to.

   @Status replaces the original @IsPaid BIT (changed 2026-10-06, before this module's
   first build+publish — no external caller to keep compatible). Idempotent-quiet:
   setting a member to the status he is already in is a silent no-op, so a screen that
   reloads and re-submits the same selection never pollutes the history. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberPaymentTag_Set
    @RequestingMemberId INT,
    @MemberId  INT,
    @Status    NVARCHAR(10),  -- 'Paid' | 'Unpaid' | 'Free'
    @MembershipYear INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Status NOT IN ('Paid', 'Unpaid', 'Free')
        THROW 51915, 'Status must be Paid, Unpaid, or Free.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);
    IF @MembershipYear IS NULL
    BEGIN
        DECLARE @Anniversary DATE = DATEFROMPARTS(YEAR(@Today), 8, 8);
        SET @MembershipYear = CASE WHEN @Today > @Anniversary THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;
    END

    DECLARE @NationalCouncilId INT;
    SELECT TOP (1) @NationalCouncilId = c.CouncilId
    FROM   dbo.Council c
           JOIN dbo.CouncilLevel cl ON cl.CouncilLevelId = c.CouncilLevelId
    WHERE  c.ParentCouncilId IS NULL
      AND  cl.LevelName = 'National';

    IF @NationalCouncilId IS NULL
        THROW 51910, 'The National Council is not configured.', 1;

    IF NOT EXISTS (
        SELECT 1
        FROM   dbo.MemberRole mr
               JOIN dbo.Role r ON r.RoleId = mr.RoleId
        WHERE  mr.MemberId  = @RequestingMemberId
          AND  mr.ScopeType = 'Council' AND mr.ScopeId = @NationalCouncilId
          AND  mr.TermStart <= @Today AND (mr.TermEnd IS NULL OR mr.TermEnd >= @Today)
          AND  r.RoleName = 'CouncilAdmin'
    )
        THROW 51911, 'Only the National Council Admin may tag member payment status.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51913, 'Member not found.', 1;

    DECLARE @ActionType NVARCHAR(10) = CASE @Status
        WHEN 'Paid'   THEN 'Tagged'
        WHEN 'Free'   THEN 'Free'
        WHEN 'Unpaid' THEN 'Untagged'
    END;

    DECLARE @CurrentStatus NVARCHAR(10) = 'Unpaid';
    DECLARE @LatestActionType NVARCHAR(10);
    SELECT TOP (1) @LatestActionType = ActionType
    FROM   dbo.MemberPaymentTagAction
    WHERE  MemberId = @MemberId AND MembershipYear = @MembershipYear
    ORDER BY PerformedDate DESC, MemberPaymentTagActionId DESC;

    SET @CurrentStatus = CASE @LatestActionType
        WHEN 'Tagged'   THEN 'Paid'
        WHEN 'Free'     THEN 'Free'
        WHEN 'Untagged' THEN 'Unpaid'
        ELSE 'Unpaid'   -- no row yet
    END;

    IF @CurrentStatus = @Status
        RETURN;

    BEGIN TRAN;
        INSERT dbo.MemberPaymentTagAction (MemberId, MembershipYear, ActionType, PerformedBy)
        VALUES (@MemberId, @MembershipYear, @ActionType, @RequestingMemberId);

        INSERT dbo.AuditLog (TableName, RecordId, [Action], NewValues, PerformedBy)
        VALUES ('Member', CAST(@MemberId AS NVARCHAR(40)),
                CASE @Status WHEN 'Paid' THEN 'PaymentTagged' WHEN 'Free' THEN 'PaymentFreed' ELSE 'PaymentUntagged' END,
                CONCAT(N'{"MembershipYear":', @MembershipYear, N'}'), @RequestingMemberId);
    COMMIT;
END
GO
