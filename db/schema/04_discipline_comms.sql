/* 04 — Corrective actions (never deleted), announcements, memos, chat. */
IF OBJECT_ID('dbo.CorrectiveActionCategory') IS NULL
CREATE TABLE dbo.CorrectiveActionCategory (
    CategoryId INT IDENTITY PRIMARY KEY,
    CategoryName NVARCHAR(60) NOT NULL UNIQUE
);
GO
IF OBJECT_ID('dbo.CorrectiveAction') IS NULL
CREATE TABLE dbo.CorrectiveAction (
    CaseId     INT IDENTITY PRIMARY KEY,
    ChapterId  INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    MemberId   INT NOT NULL REFERENCES dbo.Member(MemberId),
    CategoryId INT NOT NULL REFERENCES dbo.CorrectiveActionCategory(CategoryId),
    DateFiled  DATE NOT NULL,
    FiledBy    INT NOT NULL,
    /* Content is the NARRATIVE. Option B: never returned to ordinary members. */
    Content    NVARCHAR(MAX) NOT NULL,
    StatusName NVARCHAR(20) NOT NULL,      -- Pending|Under Review|Reconciled|Dismissed
    ResolutionNotes NVARCHAR(MAX) NULL,
    ResolutionDate  DATE NULL
);
GO
CREATE OR ALTER TRIGGER dbo.TR_CorrectiveAction_NoDelete
ON dbo.CorrectiveAction INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51002, 'CorrectiveAction is never deleted. Change the status instead.', 1;
END
GO
IF OBJECT_ID('dbo.CorrectiveActionUpdate') IS NULL
CREATE TABLE dbo.CorrectiveActionUpdate (
    UpdateId   INT IDENTITY PRIMARY KEY,
    CaseId     INT NOT NULL REFERENCES dbo.CorrectiveAction(CaseId),
    UpdateDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT NOT NULL,
    StatusName NVARCHAR(20) NOT NULL,
    Notes      NVARCHAR(MAX) NULL
);
GO
IF OBJECT_ID('dbo.Announcement') IS NULL
CREATE TABLE dbo.Announcement (
    AnnouncementId INT IDENTITY PRIMARY KEY,
    ScopeType NVARCHAR(20) NOT NULL,       -- Chapter|Council|National
    ScopeId   INT NOT NULL,
    Title     NVARCHAR(250) NOT NULL,
    Body      NVARCHAR(MAX) NOT NULL,
    IsUrgent  BIT NOT NULL DEFAULT 0,
    UrgentType NVARCHAR(30) NULL,          -- BloodRequest|Assistance
    BloodTypeId INT NULL REFERENCES dbo.BloodType(BloodTypeId),
    PublishDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiryDate  DATETIME2 NULL,
    CreatedBy INT NOT NULL
);
GO
IF OBJECT_ID('dbo.Memo') IS NULL
CREATE TABLE dbo.Memo (
    MemoId     INT IDENTITY PRIMARY KEY,
    MemoNumber NVARCHAR(30) NOT NULL UNIQUE,
    ScopeType  NVARCHAR(20) NOT NULL,
    ScopeId    INT NOT NULL,
    Title      NVARCHAR(250) NOT NULL,
    Body       NVARCHAR(MAX) NOT NULL,
    AttachmentPath NVARCHAR(400) NULL,
    PublishDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy  INT NOT NULL
);
GO
IF OBJECT_ID('dbo.ReadReceipt') IS NULL
CREATE TABLE dbo.ReadReceipt (
    ReadReceiptId INT IDENTITY PRIMARY KEY,
    DocumentType NVARCHAR(20) NOT NULL,
    DocumentId   INT NOT NULL,
    MemberId     INT NOT NULL REFERENCES dbo.Member(MemberId),
    ReadDate     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_ReadReceipt UNIQUE (DocumentType, DocumentId, MemberId)
);
GO
IF OBJECT_ID('dbo.ChatRoom') IS NULL
CREATE TABLE dbo.ChatRoom (
    RoomId    INT IDENTITY PRIMARY KEY,
    RoomType  NVARCHAR(10) NOT NULL,       -- Public|Private
    ChapterId INT NULL REFERENCES dbo.Chapter(ChapterId),
    RoomName  NVARCHAR(120) NULL
);
GO
IF OBJECT_ID('dbo.ChatMessage') IS NULL
CREATE TABLE dbo.ChatMessage (
    MessageId INT IDENTITY PRIMARY KEY,
    RoomId    INT NOT NULL REFERENCES dbo.ChatRoom(RoomId),
    SenderId  INT NOT NULL REFERENCES dbo.Member(MemberId),
    Body      NVARCHAR(MAX) NULL,
    AttachmentPath NVARCHAR(400) NULL,
    SentDate  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    IsDeleted BIT NOT NULL DEFAULT 0,      -- soft: hidden from members, kept for moderation
    DeletedBy INT NULL,
    FlagCount INT NOT NULL DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_ChatMessage_Room_Date')
    CREATE INDEX IX_ChatMessage_Room_Date ON dbo.ChatMessage(RoomId, SentDate DESC);
GO
