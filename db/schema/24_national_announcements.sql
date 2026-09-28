/* National announcements — client decision 2026-09-27. dbo.Announcement's ScopeType/
   ScopeId were already polymorphic for exactly this ("Chapter|Council|National" —
   usp_Announcement_Create's own header comment called this out as a future
   council-cascade path); this just writes the first 'National' row, via
   usp_Announcement_CreateNational, National Council Admin only. See that procedure and
   usp_Announcement_GetForMember (now unions National-scope rows into every member's own
   feed) for the rest of the mechanics. No new table for the announcement itself.

   AnnouncementPush: a third per-member opt-out, alongside PrivateMessagePush/
   MentionPush — same default-enabled convention (see usp_NotificationPreference_Get's
   own header comment on why no row is pre-inserted for the whole membership). */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NotificationPreference') AND name = 'AnnouncementPush')
    ALTER TABLE dbo.NotificationPreference ADD AnnouncementPush BIT NOT NULL DEFAULT 1;
GO
