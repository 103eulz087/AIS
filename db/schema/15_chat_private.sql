/* 15 — Private chat + push notifications (docs/AIS-Project-Documentation.md §4.8, second
   slice). Builds on db/schema/14_chat.sql, which is NOT modified by this file — this is
   additive only, same idempotency style (IF OBJECT_ID / sys.columns / sys.foreign_keys /
   sys.check_constraints / sys.indexes), same "safe to re-run" guarantee.

   Three confirmed decisions this file encodes (do not relitigate — see the tech-lead
   plan for this slice):

   1. SAME-CHAPTER ONLY TO START. A member may only START a private conversation with
      another member of his OWN chapter — matching docs §4.2's rule that cross-chapter
      contact goes through the Chapter Admin. This is enforced in
      usp_ChatRoom_EnsurePrivate, not here, but the schema shape below (a private room
      never has a ChapterId) is what makes that enforcement meaningful.

      This is a CREATION-time check only. An ALREADY-EXISTING room is never re-verified
      against either participant's current chapter: usp_ChatMessage_GetPrivateHistory,
      usp_ChatMessage_PostPrivate, usp_ChatParticipant_MarkReadPrivate and
      usp_ChatParticipant_SetMute all authorize on "is the caller one of this room's two
      stored MemberAId/MemberBId" alone. So if a participant later becomes detached
      (ChapterId goes NULL — his chapter went dormant), the conversation is NOT severed;
      both parties keep reading and posting exactly as before. We do not silently cut a
      brother off from an existing conversation because his chapter went dormant — we
      only decline to let him START a new one while detached. Do not "fix" the read/
      write procs to re-check same-chapter-right-now; that would sever every existing
      conversation the instant one party's chapter goes dormant, which is the opposite
      of the intended behaviour and has no test currently guarding against it being
      reintroduced other than this comment and the accompanying regression test.

   2. A PRIVATE ROOM'S ChapterId IS NEVER SET, BY ANYTHING, EVER. This is not an
      oversight to "fix" later. usp_ChatMessage_Flag and usp_ChatMessage_Delete
      (db/procs/) both resolve their chapter via the message's room and throw "not
      found" when that chapter is NULL — so a private room is automatically
      unmoderatable by the existing public-chat moderation procs, by construction, for
      free. Giving a private room a ChapterId would silently open private
      conversations to chapter-officer moderation, which is exactly what "private"
      means it must not do.

   3. RETENTION for a private room is NOT a new column. A future purge module resolves
      it as MIN() of the two participants' Chapter.ChatRetentionMonths
      (db/schema/01_organization.sql), looked up at purge time via MemberAId/
      MemberBId → Member.ChapterId → Chapter.ChatRetentionMonths. Recorded here so the
      purge module doesn't have to re-derive this decision.

   Error range for this slice's procedures: 51280-51289 (14_chat.sql's procs fully
   consumed 51270-51279). */

/* ---- ChatRoom: add the private-pair columns. Both NULL for every existing (Public)
   row, which is exactly the shape CK_ChatRoom_Shape below requires of them. ---- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ChatRoom') AND name = 'MemberAId')
    ALTER TABLE dbo.ChatRoom ADD MemberAId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ChatRoom') AND name = 'MemberBId')
    ALTER TABLE dbo.ChatRoom ADD MemberBId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ChatRoom_MemberA')
    ALTER TABLE dbo.ChatRoom WITH CHECK
    ADD CONSTRAINT FK_ChatRoom_MemberA FOREIGN KEY (MemberAId) REFERENCES dbo.Member(MemberId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ChatRoom_MemberB')
    ALTER TABLE dbo.ChatRoom WITH CHECK
    ADD CONSTRAINT FK_ChatRoom_MemberB FOREIGN KEY (MemberBId) REFERENCES dbo.Member(MemberId);
GO

/* Canonical ordering AND "no self-conversation", both for free: NULL < NULL (both
   Public-room columns) is UNKNOWN, which a CHECK constraint treats as satisfied, so
   existing Public rows are untouched by this; and no member id is ever less than
   itself, so @A = @B can never pass this constraint even if a caller tried. */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ChatRoom_PrivatePair')
    ALTER TABLE dbo.ChatRoom WITH CHECK
    ADD CONSTRAINT CK_ChatRoom_PrivatePair CHECK (MemberAId < MemberBId);
GO

/* Added WITH CHECK deliberately: this validates against every existing row, Public
   rows included. If a row anywhere violated this shape, deployment must stop and say
   so clearly rather than silently grandfathering bad data in with NOCHECK. */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ChatRoom_Shape')
    ALTER TABLE dbo.ChatRoom WITH CHECK
    ADD CONSTRAINT CK_ChatRoom_Shape CHECK (
        (RoomType = 'Public'  AND ChapterId IS NOT NULL AND MemberAId IS NULL     AND MemberBId IS NULL)
     OR (RoomType = 'Private' AND ChapterId IS NULL     AND MemberAId IS NOT NULL AND MemberBId IS NOT NULL)
    );
GO

/* Race-safe "one Private room per unordered pair" — the private-room mirror of
   UX_ChatRoom_PublicPerChapter (db/schema/14_chat.sql). usp_ChatRoom_EnsurePrivate
   canonically orders (MemberAId, MemberBId) before writing, so this unique filtered
   index is what makes two members opening a DM with each other for the first time,
   at the same instant, from either direction, race-safe under READ COMMITTED. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ChatRoom_PrivatePair')
    CREATE UNIQUE INDEX UX_ChatRoom_PrivatePair ON dbo.ChatRoom(MemberAId, MemberBId) WHERE RoomType = 'Private';
GO

/* "My conversations" is looked up from either side of the pair — usp_ChatRoom_ListPrivate
   filters on MemberAId = @me OR MemberBId = @me, so both sides need their own index. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChatRoom_PrivateA')
    CREATE INDEX IX_ChatRoom_PrivateA ON dbo.ChatRoom(MemberAId) WHERE RoomType = 'Private';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChatRoom_PrivateB')
    CREATE INDEX IX_ChatRoom_PrivateB ON dbo.ChatRoom(MemberBId) WHERE RoomType = 'Private';
GO

/* ---- ChatMessageMention: which members were @-mentioned in a message. Mention
   VERIFICATION (is this a real member, in the right chapter, actually named in the
   body, not the sender himself) happens in usp_ChatMessage_Post — this table only
   stores the survivors of that check. It is never populated by parsing free text on
   its own; dbo.GiftName has no uniqueness constraint (db/schema/02_members.sql), which
   is exactly why the app resolves a mention via a picker (a specific MemberId) and
   this database layer only confirms that claimed id, never infers one from text. ---- */
IF OBJECT_ID('dbo.ChatMessageMention') IS NULL
CREATE TABLE dbo.ChatMessageMention (
    MessageId INT NOT NULL REFERENCES dbo.ChatMessage(MessageId),
    MemberId  INT NOT NULL REFERENCES dbo.Member(MemberId),
    CONSTRAINT PK_ChatMessageMention PRIMARY KEY (MessageId, MemberId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ChatMessageMention_Member')
    CREATE INDEX IX_ChatMessageMention_Member ON dbo.ChatMessageMention(MemberId);
GO

/* ---- PushSubscription: one row per browser/device subscription (the Web Push
   protocol's endpoint + keys), never per member — a member with two phones has two
   rows. A dead subscription (the push service answers 404/410 when the app tries to
   use it — the device unsubscribed, cleared site data, or the OS revoked it) is
   HARD-DELETED by usp_PushSubscription_Prune, never soft-deleted. This is deliberate:
   this row is ephemeral device state, not an organizational record, and no CLAUDE.md
   invariant covers it — do not add a soft-delete column here by analogy with
   ChatMessage or CorrectiveAction; those are append-only/never-deleted because they
   are permanent facts about the organization, and a stale push endpoint is neither. ---- */
IF OBJECT_ID('dbo.PushSubscription') IS NULL
CREATE TABLE dbo.PushSubscription (
    SubscriptionId INT IDENTITY PRIMARY KEY,
    AccountId      INT NOT NULL REFERENCES dbo.UserAccount(AccountId),
    Endpoint       NVARCHAR(500) NOT NULL,
    P256dh         NVARCHAR(200) NOT NULL,
    AuthSecret     NVARCHAR(100) NOT NULL,
    DeviceHint     NVARCHAR(120) NULL,
    CreatedOn      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    LastSuccessOn  DATETIME2 NULL,
    FailureCount   INT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_PushSubscription_Endpoint UNIQUE (Endpoint)
);
GO
/* Used by usp_PushSubscription_GetForMember's join (Member -> UserAccount -> here),
   the only read this table serves other than lookup-by-endpoint (already covered by
   the unique constraint above). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PushSubscription_Account')
    CREATE INDEX IX_PushSubscription_Account ON dbo.PushSubscription(AccountId);
GO

/* ---- NotificationPreference: per-member mute-everything-except-mentions capability.
   Absence of a row reads as "both enabled" — usp_NotificationPreference_Get returns
   (1,1) for a member with no row, so no row is ever pre-inserted for the whole
   membership just to have default values on hand; a row here only ever means "this
   member changed something from the default". ---- */
IF OBJECT_ID('dbo.NotificationPreference') IS NULL
CREATE TABLE dbo.NotificationPreference (
    MemberId           INT NOT NULL PRIMARY KEY REFERENCES dbo.Member(MemberId),
    PrivateMessagePush BIT NOT NULL DEFAULT 1,
    MentionPush        BIT NOT NULL DEFAULT 1,
    UpdatedOn          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
