/* 03 — Meetings, activities, and the append-only ledger. */
IF OBJECT_ID('dbo.Meeting') IS NULL
CREATE TABLE dbo.Meeting (
    MeetingId     INT IDENTITY PRIMARY KEY,
    ChapterId     INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    Subject       NVARCHAR(250) NOT NULL,
    MeetingDate   DATE NOT NULL,
    Body          NVARCHAR(MAX) NULL,
    Location      NVARCHAR(200) NULL,
    IsFinalized   BIT NOT NULL DEFAULT 0,   -- once true, attendance is read-only
    FinalizedBy   INT NULL,
    FinalizedDate DATETIME2 NULL,
    CreatedBy     INT NOT NULL,
    CreatedDate   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    RowVersion    ROWVERSION
);
GO
IF OBJECT_ID('dbo.AttendanceStatus') IS NULL
CREATE TABLE dbo.AttendanceStatus (
    AttendanceStatusId INT IDENTITY PRIMARY KEY,
    StatusName NVARCHAR(20) NOT NULL UNIQUE   -- Present, Late, Excused, Absent
);
GO
IF OBJECT_ID('dbo.MeetingAttendance') IS NULL
CREATE TABLE dbo.MeetingAttendance (
    MeetingAttendanceId INT IDENTITY PRIMARY KEY,
    MeetingId  INT NOT NULL REFERENCES dbo.Meeting(MeetingId),
    MemberId   INT NOT NULL REFERENCES dbo.Member(MemberId),
    AttendanceStatusId INT NOT NULL REFERENCES dbo.AttendanceStatus(AttendanceStatusId),
    /* Contributions are VOLUNTARY. Zero and NULL are both normal.
       No arrears is ever derived from this column. */
    FundAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
    CheckedInAt   DATETIME2 NULL,
    CheckedInVia  NVARCHAR(10) NULL,        -- 'Manual' | 'QR'
    Remarks    NVARCHAR(250) NULL,
    CONSTRAINT UQ_Attendance UNIQUE (MeetingId, MemberId)   -- a QR rescan cannot double-count
);
GO
IF OBJECT_ID('dbo.Activity') IS NULL
CREATE TABLE dbo.Activity (
    ActivityId   INT IDENTITY PRIMARY KEY,
    ChapterId    INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    ActivityName NVARCHAR(200) NOT NULL,
    ActivityDate DATE NULL,
    Description  NVARCHAR(MAX) NULL,
    IsClosed     BIT NOT NULL DEFAULT 0
);
GO
/* ---- THE LEDGER. Append-only. Enforced by trigger, not by convention. ---- */
IF OBJECT_ID('dbo.LedgerEntry') IS NULL
CREATE TABLE dbo.LedgerEntry (
    LedgerEntryId INT IDENTITY PRIMARY KEY,
    ChapterId     INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    EntryDate     DATE NOT NULL,
    EntryType     CHAR(3) NOT NULL,                -- 'In' | 'Out'
    Amount        DECIMAL(18,2) NOT NULL,
    Description   NVARCHAR(400) NOT NULL,
    SourceType    NVARCHAR(30) NOT NULL,           -- Meeting|Expense|Donation|Remittance|Manual
    SourceId      INT NULL,
    ActivityId    INT NULL REFERENCES dbo.Activity(ActivityId),
    IsReversal    BIT NOT NULL DEFAULT 0,
    ReversesEntryId INT NULL REFERENCES dbo.LedgerEntry(LedgerEntryId),
    CreatedBy     INT NOT NULL,
    CreatedDate   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Ledger_Type CHECK (EntryType IN ('In','Out')),
    CONSTRAINT CK_Ledger_Amount CHECK (Amount > 0)
);
GO
CREATE OR ALTER TRIGGER dbo.TR_LedgerEntry_NoUpdateDelete
ON dbo.LedgerEntry INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51001, 'LedgerEntry is append-only. Use usp_Ledger_Reverse to correct an entry.', 1;
END
GO
IF OBJECT_ID('dbo.Expense') IS NULL
CREATE TABLE dbo.Expense (
    ExpenseId   INT IDENTITY PRIMARY KEY,
    ChapterId   INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    ActivityId  INT NULL REFERENCES dbo.Activity(ActivityId),
    ExpenseDate DATE NOT NULL,
    Payee       NVARCHAR(150) NOT NULL,
    Description NVARCHAR(400) NOT NULL,
    Amount      DECIMAL(18,2) NOT NULL,
    RecordedBy  INT NOT NULL,
    ApprovedBy  INT NULL,
    IsDeleted   BIT NOT NULL DEFAULT 0
);
GO
IF OBJECT_ID('dbo.ExpenseAttachment') IS NULL
CREATE TABLE dbo.ExpenseAttachment (
    AttachmentId INT IDENTITY PRIMARY KEY,
    ExpenseId INT NOT NULL REFERENCES dbo.Expense(ExpenseId),
    FilePath  NVARCHAR(400) NOT NULL,
    FileName  NVARCHAR(200) NOT NULL,
    FileSize  INT NOT NULL,
    UploadedBy INT NOT NULL
);
GO
IF OBJECT_ID('dbo.Donation') IS NULL
CREATE TABLE dbo.Donation (
    DonationId  INT IDENTITY PRIMARY KEY,
    ChapterId   INT NOT NULL REFERENCES dbo.Chapter(ChapterId),
    ActivityId  INT NULL REFERENCES dbo.Activity(ActivityId),
    DonationDate DATE NOT NULL,
    DonorName   NVARCHAR(200) NOT NULL,
    DonorType   NVARCHAR(40) NOT NULL,     -- Government Official|Private|Business|Member
    Subject     NVARCHAR(250) NULL,
    Body        NVARCHAR(MAX) NULL,
    Amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
    InKindDescription NVARCHAR(400) NULL,
    AckReceiptNo NVARCHAR(40) NULL,
    RecordedBy  INT NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Ledger_Chapter_Date')
    CREATE INDEX IX_Ledger_Chapter_Date ON dbo.LedgerEntry(ChapterId, EntryDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Attendance_Meeting')
    CREATE INDEX IX_Attendance_Meeting ON dbo.MeetingAttendance(MeetingId);
GO
