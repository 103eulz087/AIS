/* Records that a member finished (Completed) or skipped (Skipped) a guided tour, and which
   version of its steps he saw (db/schema/31_member_tutorial.sql). One row per member and
   tour, moved forward on every finish — replaying the tour from Profile just updates it.
   Audited in the same transaction (invariant #10). @MemberId comes from his token. */
CREATE OR ALTER PROCEDURE dbo.usp_MemberTutorial_Finish
    @MemberId    INT,
    @TourKey     NVARCHAR(40),
    @TourVersion INT,
    @Outcome     NVARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Tutorial WHERE TourKey = @TourKey AND IsActive = 1)
        THROW 51960, 'That tour was not recognised.', 1;
    IF @TourVersion IS NULL OR @TourVersion < 1
        THROW 51961, 'The tour version must be 1 or more.', 1;
    IF @Outcome IS NULL OR @Outcome NOT IN (N'Completed', N'Skipped')
        THROW 51962, 'The outcome must be Completed or Skipped.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51963, 'Member not found.', 1;

    DECLARE @OldVersion INT, @OldOutcome NVARCHAR(10);
    SELECT @OldVersion = TourVersion, @OldOutcome = Outcome
    FROM   dbo.MemberTutorial WHERE MemberId = @MemberId AND TourKey = @TourKey;

    BEGIN TRAN;
        IF @OldVersion IS NULL
            INSERT dbo.MemberTutorial (MemberId, TourKey, TourVersion, Outcome)
            VALUES (@MemberId, @TourKey, @TourVersion, @Outcome);
        ELSE
            UPDATE dbo.MemberTutorial
               SET TourVersion = @TourVersion, Outcome = @Outcome, FinishedDate = SYSUTCDATETIME()
             WHERE MemberId = @MemberId AND TourKey = @TourKey;

        INSERT dbo.AuditLog (TableName, RecordId, [Action], OldValues, NewValues, PerformedBy)
        VALUES (N'MemberTutorial', CONCAT(@MemberId, N':', @TourKey), N'TourFinish',
                CASE WHEN @OldVersion IS NULL THEN NULL
                     ELSE CONCAT(N'{"TourVersion":', @OldVersion, N',"Outcome":"', @OldOutcome, N'"}') END,
                CONCAT(N'{"TourVersion":', @TourVersion, N',"Outcome":"', @Outcome, N'"}'),
                @MemberId);
    COMMIT;
END
GO
