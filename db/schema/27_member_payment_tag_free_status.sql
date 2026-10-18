/* Member payment tagging, tri-state slice (client decision 2026-10-06, before the first
   build+publish of this module — nothing in production yet, so this is a straight
   widening of the original constraint rather than a migration with existing data to
   reconcile). A member can now be 'Free' — given free membership for the year, some
   members are — in addition to 'Tagged' (paid) and 'Untagged' (reset to unpaid).

   'Free' behaves exactly like 'Tagged' for the Digital ID watermark (both suppress "NOT
   YET PAID" — see usp_Credential_GetOrIssueForSelf/_VerifyPublic's own IsPaid formula,
   updated alongside this file) but is tracked as its own distinct state everywhere the
   National Council itself manages or reports on payment tags (the Payment Tags screen's
   own 3-way control, and usp_MemberPaymentTag_GetStats's own Paid/Free/Unpaid counts) —
   "free" and "actually paid" are different facts worth telling apart, even though a
   member's own ID card doesn't need to. */
DECLARE @ConstraintName SYSNAME = (
    SELECT name FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.MemberPaymentTagAction')
      AND name = 'CK_MemberPaymentTagAction_ActionType'
);
IF @ConstraintName IS NOT NULL
    EXEC('ALTER TABLE dbo.MemberPaymentTagAction DROP CONSTRAINT ' + @ConstraintName);

ALTER TABLE dbo.MemberPaymentTagAction
    ADD CONSTRAINT CK_MemberPaymentTagAction_ActionType CHECK (ActionType IN ('Tagged', 'Untagged', 'Free'));
GO
