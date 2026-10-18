/* Member payment tagging — client decision 2026-09-29: a simple, standalone "has this
   member paid this year" flag for National Council to track during initial chapter
   rollout. Deliberately SEPARATE from the existing RenewalPeriod/ChapterRenewal/
   MemberRenewal/AckReceipt module (05_identity_renewal.sql) — that system already
   models "paid" via MemberRenewal.RenewalStatus/FeeAmount, inside a formal, chapter-
   submitted, council-approved renewal application. This is a lighter, National-driven
   tag for right now: no amount, no receipt, no chapter submission — just a checkmark.
   The client was shown the alternative (reuse the existing renewal status instead) and
   chose this path anyway, knowing the two now track "paid" independently.

   Append-only action log, same shape as dbo.MemberAccountAction/dbo.ChapterHoldAction —
   never an UPDATE/DELETE on a single row. "Is this member currently tagged paid" is
   always "does his most recent action for this membership year say Tagged, with no
   later Untagged" — see usp_MemberPaymentTag_GetChapterMembers's own LatestAction CTE. */
IF OBJECT_ID('dbo.MemberPaymentTagAction') IS NULL
CREATE TABLE dbo.MemberPaymentTagAction (
    MemberPaymentTagActionId INT IDENTITY PRIMARY KEY,
    MemberId       INT           NOT NULL REFERENCES dbo.Member(MemberId),
    MembershipYear INT           NOT NULL,   -- named by the year it opens, same convention as Akrho.Domain.MembershipYear
    ActionType     NVARCHAR(10)  NOT NULL
        CONSTRAINT CK_MemberPaymentTagAction_ActionType CHECK (ActionType IN ('Tagged', 'Untagged')),
    PerformedBy    INT           NOT NULL REFERENCES dbo.Member(MemberId),
    PerformedDate  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MemberPaymentTagAction_Member')
    CREATE INDEX IX_MemberPaymentTagAction_Member
        ON dbo.MemberPaymentTagAction(MemberId, MembershipYear, PerformedDate DESC);
GO
