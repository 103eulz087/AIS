/* ============================================================================
   How-to guides (2026-10-19).

   The first-login tours (31_member_tutorial.sql) say what each part of the app IS. These
   guides show how to DO things, step by step on the real screens: open Meetings, tap New
   meeting, fill the date, mark attendance, save. They live on a "Help & guides" page in
   the member app and in the Portal menu, each shown only to people whose role can use it.

   Same tables as the tours: each guide is a dbo.Tutorial row, and a member finishing or
   skipping one is a dbo.MemberTutorial row written by usp_MemberTutorial_Finish (audited),
   so the Help page can tick the guides he has done, on any device. Keys are referenced by
   the web app (src/web/src/shared/tour/guides); add a row here before shipping a guide.
   ============================================================================ */

INSERT dbo.Tutorial (TourKey, DisplayName)
SELECT v.TourKey, v.DisplayName
FROM (VALUES
    -- Member app — everyone
    (N'guide-members',             N'Find a brother in your chapter'),
    (N'guide-funds',               N'Read your chapter''s books'),
    (N'guide-announcements',       N'Read announcements'),
    (N'guide-digital-id',          N'Show your Digital ID and scan a QR'),
    (N'guide-profile',             N'Update your profile and install the app'),
    -- Member app — chapter officers
    (N'guide-meetings',            N'Record a meeting and attendance'),
    (N'guide-money',               N'Record an expense, donation or activity'),
    (N'guide-post-announcement',   N'Post an announcement'),
    (N'guide-approvals',           N'Approve a new member and share the join link'),
    -- Council Portal
    (N'guide-portal-registrations', N'Review and approve a chapter registration'),
    (N'guide-portal-seating',       N'Seat or unseat a council officer'),
    (N'guide-portal-permissions',   N'Set what each office can do'),
    (N'guide-portal-payments',      N'Tag payments and use the payment report'),
    (N'guide-portal-members',       N'Search members across your jurisdiction'),
    (N'guide-portal-settings',      N'Set up the free trial')
) AS v(TourKey, DisplayName)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Tutorial t WHERE t.TourKey = v.TourKey);
GO
