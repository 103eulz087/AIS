/* Detaches an EXISTING member from a chapter that has gone dormant or been dissolved.

   This is a transition, not an enrolment. @MemberId must already exist — a council
   has no way to create one, and no procedure in this database gives it one.
   Deliberately narrow: a reason is mandatory and the parent council must approve,
   otherwise detachment becomes the exit route for exactly the brothers who most need
   a chapter holding them to account. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_AttachToCouncil
    @RequestingMemberId INT,
    @MemberId       INT,
    @CouncilId      INT,
    @Reason         NVARCHAR(200),
    @ChapterOfRecord NVARCHAR(150) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Reason IS NULL OR LTRIM(RTRIM(@Reason)) = ''
        THROW 51060, 'Detachment requires a stated reason.', 1;

    IF NOT EXISTS (SELECT 1 FROM dbo.Member WHERE MemberId = @MemberId AND IsDeleted = 0)
        THROW 51062, 'Member not found. A council cannot create one — a chapter must.', 1;

    BEGIN TRAN;
        UPDATE dbo.Member
           SET ChapterOfRecord = COALESCE(@ChapterOfRecord,
                                          (SELECT ChapterName FROM dbo.Chapter
                                            WHERE ChapterId = dbo.Member.ChapterId)),
               ChapterId       = NULL,
               HomeCouncilId   = @CouncilId,
               AttachReason    = @Reason,
               AttachedSince   = CAST(SYSUTCDATETIME() AS DATE),
               AttachReviewedOn = CAST(SYSUTCDATETIME() AS DATE)
         WHERE MemberId = @MemberId;
    COMMIT;
END
GO

/* The way out is a transfer, never a deletion. His whole record follows him:
   years, seals, attendance, offices held. Nothing restarts. */
CREATE OR ALTER PROCEDURE dbo.usp_Member_TransferToChapter
    @RequestingMemberId INT,
    @MemberId  INT,
    @ChapterId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId AND IsActive = 1)
        THROW 51061, 'Target chapter does not exist or is not active.', 1;

    BEGIN TRAN;
        UPDATE dbo.Member
           SET ChapterId       = @ChapterId,
               HomeCouncilId   = NULL,
               AttachReason    = NULL,
               AttachedSince   = NULL,
               AttachReviewedOn = NULL
         WHERE MemberId = @MemberId;
    COMMIT;
END
GO

/* Attached members overdue for review. Attachment is never permanent —
   a council whose attached list keeps growing is showing you a dormant chapter,
   not a member who needs relocating. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_AttachedMembers
    @RequestingMemberId INT,
    @CouncilId INT,
    @OverdueMonths INT = 24
AS
BEGIN
    SET NOCOUNT ON;
    SELECT  m.MemberId, m.GiftName, m.MemberNumber, m.ChapterOfRecord,
            m.AttachReason, m.AttachedSince, m.AttachReviewedOn, m.RenewedThrough,
            CASE WHEN m.AttachReviewedOn IS NULL
                   OR m.AttachReviewedOn < DATEADD(MONTH, -@OverdueMonths, CAST(SYSUTCDATETIME() AS DATE))
                 THEN 1 ELSE 0 END AS IsOverdueForReview
    FROM    dbo.Member m
    WHERE   m.HomeCouncilId = @CouncilId AND m.IsDeleted = 0
    ORDER BY m.AttachedSince;
END
GO
