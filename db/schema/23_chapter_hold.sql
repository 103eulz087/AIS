/* Chapter hold — client decision 2026-09-22: a council-level power to freeze an entire
   chapter's logins at once, distinct from (and wider than) usp_Member_Block's existing
   single-member block. That proc's own header records a deliberate prior decision to
   keep account-management power narrowed to National Council alone, specifically
   because "a standing power to manage any member's account anywhere beneath a council
   is the thing this codebase has consistently refused to build." This feature knowingly
   reopens that door one notch, on the client's explicit instruction after that precedent
   was raised: BOTH National Council AND a chapter's own resolved governing council
   (usp_Approval_ResolveApprover's "nearest ancestor with seated officers" — the same
   routing primitive used everywhere else in this codebase, never a second mechanism) may
   place a chapter on hold or release it. See usp_Chapter_Hold.sql for the authority
   check itself.

   IsOnHold is the FAST gate — checked at sign-in and nowhere else needs to walk
   ChapterHoldAction's history to answer "can this member log in right now." Same split
   as dbo.UserAccount.IsDisabled (the gate) vs. dbo.MemberAccountAction (the append-only
   audit trail): ChapterHoldAction is that same audit trail at chapter scope, never
   updated or deleted, only ever appended to. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Chapter') AND name = 'IsOnHold')
    ALTER TABLE dbo.Chapter ADD IsOnHold BIT NOT NULL DEFAULT 0;
GO

IF OBJECT_ID('dbo.ChapterHoldAction') IS NULL
CREATE TABLE dbo.ChapterHoldAction (
    ChapterHoldActionId INT IDENTITY PRIMARY KEY,
    ChapterId           INT           NOT NULL REFERENCES dbo.Chapter(ChapterId),
    ActionType          NVARCHAR(20)  NOT NULL
        CONSTRAINT CK_ChapterHoldAction_ActionType
        CHECK (ActionType IN ('Held', 'Released')),
    Reason              NVARCHAR(300) NOT NULL,
    PerformedBy         INT           NOT NULL REFERENCES dbo.Member(MemberId),
    PerformedDate       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChapterHoldAction_Chapter')
    CREATE INDEX IX_ChapterHoldAction_Chapter ON dbo.ChapterHoldAction(ChapterId, PerformedDate DESC);
GO
