/* 14 — Public chat (docs/AIS-Project-Documentation.md §4.8).

   db/schema/04_discipline_comms.sql already created bare dbo.ChatRoom and
   dbo.ChatMessage. This file is additive only — nothing created there is dropped or
   narrowed — and adds everything the module needs on top: flag tracking, the
   moderation columns ChatMessage was missing, the race-safe "one public room per
   chapter" constraint, a keyset-pagination index, and dbo.ChatParticipant. Every
   guard below is idempotent (IF OBJECT_ID / sys.columns / sys.foreign_keys /
   sys.check_constraints / sys.indexes), matching db/schema/08_comms_align.sql's and
   db/schema/12_corrective_actions.sql's style. Safe to re-run.

   Three things worth recording here because a future reader will otherwise wonder:

   1. ChatMessage soft-delete (IsDeleted / DeletedBy / DeletedDate / DeleteReason) is a
      genuine UPDATE, not append-only. This is correct and intentional — it is NOT a
      violation of CLAUDE.md invariant #1 (LedgerEntry-style append-only). LedgerEntry
      and CorrectiveAction are append-only because they are the permanent record of a
      financial or disciplinary fact; a chat message is neither — it is a retained-
      for-moderation conversational artifact that the org has already decided to purge
      entirely after ChatRetentionMonths (Chapter.ChatRetentionMonths, see
      db/schema/01_organization.sql — the purge job itself is a later, separate
      module and is NOT built here). Do not "fix" this into append-only, and do not
      generalize the other way either: there is no hard DELETE anywhere in this
      module, for any role, including sysadmin. Soft-delete is the floor and the
      ceiling both.

   2. UX_ChatRoom_PublicPerChapter is a UNIQUE FILTERED INDEX, not an application-level
      "check then insert". Two members opening the chat room for the first time at the
      same instant will both attempt to create the chapter's Public room;
      usp_ChatRoom_EnsurePublic relies on THIS constraint (catching the duplicate-key
      violation and treating it as "someone else just created it") rather than a
      retry loop or a serializable transaction, because a unique constraint is the one
      thing that is actually race-safe under READ COMMITTED without extra locking.

   3. dbo.ChatParticipant is READ-STATE / PREFERENCE ONLY. It is never consulted to
      decide who may read or post in a room. Authorization is always
      Member.ChapterId = ChatRoom.ChapterId, checked fresh in every proc that touches
      chat. If ChatParticipant were ever used as an authorization source, a
      newly-approved member would silently have no access to his own chapter's room
      until a row happened to exist here — that would be a bug, not a feature.
      IsMuted ships now with no writer — there is nothing to mute until push
      notifications ship in a later module (docs §4.8's "Chat & landing" slice). */

/* ---- ChatMessageFlag: dedupes flags per member so one person can't inflate FlagCount. ---- */
IF OBJECT_ID('dbo.ChatMessageFlag') IS NULL
CREATE TABLE dbo.ChatMessageFlag (
    MessageId    INT NOT NULL REFERENCES dbo.ChatMessage(MessageId),
    MemberId     INT NOT NULL REFERENCES dbo.Member(MemberId),
    FlaggedDate  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Reason       NVARCHAR(200) NULL,
    ResolvedDate DATETIME2 NULL,
    ResolvedBy   INT NULL REFERENCES dbo.Member(MemberId),
    CONSTRAINT PK_ChatMessageFlag PRIMARY KEY (MessageId, MemberId)
);
GO

/* ---- ChatMessage: moderation columns 04_discipline_comms.sql never added. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ChatMessage') AND name = 'DeletedDate')
    ALTER TABLE dbo.ChatMessage ADD DeletedDate DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ChatMessage') AND name = 'DeleteReason')
    ALTER TABLE dbo.ChatMessage ADD DeleteReason NVARCHAR(200) NULL;
GO

/* DeletedBy has existed since 04_discipline_comms.sql as a bare INT with no FK. Added now. */
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ChatMessage_DeletedBy')
    ALTER TABLE dbo.ChatMessage WITH CHECK
    ADD CONSTRAINT FK_ChatMessage_DeletedBy FOREIGN KEY (DeletedBy) REFERENCES dbo.Member(MemberId);
GO

/* Body is NVARCHAR(MAX) with no bound today — a DoS/rendering hazard in a chat feed.
   A CHECK constraint is used rather than shrinking the column type: it caps every new
   write without an ALTER COLUMN that could fail against rows already wider than 2000
   chars, and it is exactly what CLAUDE.md's task brief calls out as sufficient.

   NOTE (tech-lead review): this CHECK is NOT reachable through the normal application
   path. usp_ChatMessage_Post declares @Body NVARCHAR(2000), and SQL Server silently
   truncates any longer value to 2000 characters at parameter-binding time, before the
   proc body — and this CHECK — ever runs. The actual gate against an oversized body
   today is the API-layer FluentValidation MaximumLength(2000) rule in
   src/Akrho.Api/Features/Chat/ChatValidators.cs. This constraint exists as
   defense-in-depth for any direct/out-of-band write to ChatMessage that does not go
   through usp_ChatMessage_Post — a DBA script, a future data import, the eventual
   retention/purge job — and it is what makes usp_ChatMessage_GetFlagged's own internal
   @Page table variable (which also declares Body NVARCHAR(2000)) safe to assume no
   wider value could ever exist in the table. Do not remove it and do not treat it as
   the thing actually protecting usp_ChatMessage_Post. */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ChatMessage_BodyLength')
    ALTER TABLE dbo.ChatMessage WITH CHECK
    ADD CONSTRAINT CK_ChatMessage_BodyLength CHECK (Body IS NULL OR LEN(Body) <= 2000);
GO

/* ---- Race-safe "one Public room per chapter". See header comment #2. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ChatRoom_PublicPerChapter')
    CREATE UNIQUE INDEX UX_ChatRoom_PublicPerChapter ON dbo.ChatRoom(ChapterId) WHERE RoomType = 'Public';
GO

/* ---- Keyset pagination pages on MessageId (IDENTITY, monotonic), not SentDate.
   IX_ChatMessage_Room_Date (04_discipline_comms.sql) stays — it is not removed — but
   it is the wrong shape for "WHERE RoomId = @r AND MessageId < @before ORDER BY
   MessageId DESC". This index is. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChatMessage_Room_Id')
    CREATE INDEX IX_ChatMessage_Room_Id ON dbo.ChatMessage(RoomId, MessageId DESC) INCLUDE (SenderId, IsDeleted);
GO

/* ---- ChatParticipant: read-state / preference only. See header comment #3. ---- */
IF OBJECT_ID('dbo.ChatParticipant') IS NULL
CREATE TABLE dbo.ChatParticipant (
    RoomId            INT NOT NULL REFERENCES dbo.ChatRoom(RoomId),
    MemberId          INT NOT NULL REFERENCES dbo.Member(MemberId),
    JoinedDate        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    LastReadMessageId INT NULL,
    IsMuted           BIT NOT NULL DEFAULT 0,
    CONSTRAINT PK_ChatParticipant PRIMARY KEY (RoomId, MemberId)
);
GO
