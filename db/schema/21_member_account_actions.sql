/* 21 — Member account actions: blocking a member's login, unblocking it, and forcing a
   password reset — all National-Council-only actions on an EXISTING member's account,
   deliberately kept OUTSIDE dbo.CorrectiveAction.

   Why a separate table rather than reusing CorrectiveAction: per client decision
   (2026-09-21), blocking a login is not the same act as disciplining a member — a
   chapter's own corrective-action process (Pending/Under Review/Reconciled/Dismissed,
   invariant #6's narrative-restriction rules) is untouched by this table and this table
   is untouched by it. This is purely an account-access record: who blocked/unblocked/
   reset whom, when, and why. A required Reason, recorded here rather than left to
   AuditLog's own free-form NewValues JSON, so a future "why was I blocked" question has
   a real row to point to, not an audit-log entry nobody built a viewer for.

   Why National-only, enforced in the procs (usp_Member_Block/_Unblock/_ResetPassword),
   not here: this table has no ScopeType/ScopeId of its own to check against — the
   authorization is "seated CouncilAdmin at the one council whose LevelName is National
   and whose ParentCouncilId is NULL", which only the proc can verify by walking
   dbo.MemberRole/dbo.Council at call time. Per client decision (2026-09-21), this is
   deliberately NOT extended to every council within its own subtree — the same
   "any council officer may manage the login of any member anywhere beneath it, forever"
   concern usp_Enrolment_Issue's own header already raises, just with the exposure
   narrowed to the one seat at the very top instead of removed.

   Mechanics reused, not reinvented: Block/ResetPassword both flip
   dbo.UserAccount.IsDisabled to 1 (a column that already exists, is already enforced at
   every sign-in/refresh/push check, and until this file had no writer ever setting it —
   see usp_Enrolment_Redeem/_Issue, whose own logic already clears it back to 0 on
   redemption or on a fresh sign-in-capable issue). ResetPassword additionally issues a
   brand-new one-time EnrolmentLink exactly the way usp_Enrolment_Issue does (invalidate
   the old live one, insert a new one) — never a password itself, never transmitted,
   CLAUDE.md invariant #16 untouched. Both also call usp_RefreshToken_RevokeFamily so an
   already-signed-in session cannot keep working after either action. */
IF OBJECT_ID('dbo.MemberAccountAction') IS NULL
CREATE TABLE dbo.MemberAccountAction (
    MemberAccountActionId INT IDENTITY PRIMARY KEY,
    MemberId              INT           NOT NULL REFERENCES dbo.Member(MemberId),
    ActionType            NVARCHAR(20)  NOT NULL
        CONSTRAINT CK_MemberAccountAction_ActionType
        CHECK (ActionType IN ('Blocked', 'Unblocked', 'PasswordReset')),
    Reason                NVARCHAR(300) NOT NULL,
    PerformedBy           INT           NOT NULL REFERENCES dbo.Member(MemberId),
    PerformedDate         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MemberAccountAction_Member')
    CREATE INDEX IX_MemberAccountAction_Member ON dbo.MemberAccountAction(MemberId, PerformedDate DESC);
GO
