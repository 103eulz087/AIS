/* ============================================================================
   The payment report gets its own switch in the office permission grid (2026-10-19).

   Until now "View payment tags" (MemberPaymentTag.Read) opened both the member payment
   tag list and the Paid/Free/Unpaid report. National asked for the report as a role of its
   own, so an office can be given the overview without the member-by-member list (or the
   other way round). New National-only key:

     MemberPaymentTag.Report — "View payment report": the per-chapter Paid/Free/Unpaid
                               counts, searchable and filterable by place.

   Not dependent on Read (an office may see the counts without seeing names). Default:
   National's President only — exactly who could see the report before (at the time of this
   change no National office had been given MemberPaymentTag.Read by override), so nobody
   loses or gains access by deploying this. The report is served by
   usp_MemberPaymentTag_GetReport, which checks this key.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM dbo.CouncilPermission WHERE PermissionKey = N'MemberPaymentTag.Report')
    INSERT dbo.CouncilPermission (PermissionKey, DisplayName, Description, IsWrite, IsNationalOnly, IsGrantable, RequiresKey, SortOrder, IsActive)
    VALUES (N'MemberPaymentTag.Report', N'View payment report',
            N'See the Paid, Free and Unpaid counts for every chapter, and search or filter them by place.',
            0, 1, 1, NULL, 85, 1);
GO

-- "View payment tags" no longer covers the report.
UPDATE dbo.CouncilPermission
   SET Description = N'See every member''s payment tag (Paid, Unpaid or Free), chapter by chapter.'
 WHERE PermissionKey = N'MemberPaymentTag.Read'
   AND Description <> N'See every member''s payment tag (Paid, Unpaid or Free), chapter by chapter.';
GO

INSERT dbo.CouncilPermissionDefault (CouncilOfficeId, PermissionKey)
SELECT co.CouncilOfficeId, N'MemberPaymentTag.Report'
FROM   dbo.CouncilOffice co
WHERE  co.OfficeName = N'President'
  AND  NOT EXISTS (SELECT 1 FROM dbo.CouncilPermissionDefault d
                   WHERE d.CouncilOfficeId = co.CouncilOfficeId AND d.PermissionKey = N'MemberPaymentTag.Report');
GO
