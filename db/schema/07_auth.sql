/* 07 — Auth: officer enrolment links, sign-in credentials, refresh tokens.
   Slice 1 is password-only by explicit product decision; 2FA is deferred, not dropped —
   see the header comment on dbo.UserAccount below. */

/* Two-factor authentication is DEFERRED, not forgotten.
   §7A.4 step 5 and CLAUDE.md §3 require a second factor on officer accounts:
   the account is not meant to work until the officer enables it. Slice 1 ships
   password-only by explicit decision, so that an officer can sign in before the
   authenticator work is done. Closing this needs two nullable columns here
   (TwoFactorSecret, TwoFactorEnabledOn) and one on EnrolmentLink. Do not treat
   the absence of those columns as a design conclusion. */
IF OBJECT_ID('dbo.UserAccount') IS NULL
CREATE TABLE dbo.UserAccount (
    AccountId         INT IDENTITY PRIMARY KEY,
    /* An account can only ever belong to a member the chapter already created.
       There is no insert path into dbo.Member from here, and never will be —
       see CLAUDE.md §2 invariant 13 / decision 20. */
    MemberId          INT           NOT NULL UNIQUE REFERENCES dbo.Member(MemberId),
    PasswordHash      NVARCHAR(200) NOT NULL,
    PasswordUpdatedOn DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    FailedAttempts    INT           NOT NULL DEFAULT 0,
    LockedUntil       DATETIME2     NULL,
    IsDisabled        BIT           NOT NULL DEFAULT 0,
    CreatedOn         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    RowVersion        ROWVERSION
);
GO

/* The one-time, 72-hour link that grants an officer his account — never a password.
   The raw token is never stored, only its hash; the hash is what usp_Enrolment_Get
   and usp_Enrolment_Redeem look up, so hashing must be symmetric between issue and
   redemption (both done by the caller, with the same algorithm). */
IF OBJECT_ID('dbo.EnrolmentLink') IS NULL
CREATE TABLE dbo.EnrolmentLink (
    LinkId            INT IDENTITY PRIMARY KEY,
    MemberId          INT           NOT NULL REFERENCES dbo.Member(MemberId),
    TokenHash         VARBINARY(32) NOT NULL UNIQUE,
    MobileNoAtIssue   NVARCHAR(30)  NOT NULL,   -- snapshot; the officer's number may change later
    IssuedOn          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    IssuedBy          INT           NOT NULL,   -- MemberId of the officer (or approving actor) who issued it
    ExpiresOn         DATETIME2     NOT NULL,   -- always IssuedOn + 72 hours
    RedeemedOn        DATETIME2     NULL,
    InvalidatedOn     DATETIME2     NULL,
    InvalidatedReason NVARCHAR(200) NULL
);
GO
/* At most one outstanding (unredeemed, uninvalidated) link per member at a time.
   usp_Enrolment_Issue invalidates the previous one before inserting a new one;
   this index is the guard against a race doing both at once. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_EnrolmentLink_ActivePerMember')
    CREATE UNIQUE INDEX UQ_EnrolmentLink_ActivePerMember ON dbo.EnrolmentLink(MemberId)
        WHERE RedeemedOn IS NULL AND InvalidatedOn IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EnrolmentLink_Member')
    CREATE INDEX IX_EnrolmentLink_Member ON dbo.EnrolmentLink(MemberId);
GO

/* Refresh tokens rotate on every use. RotatedToTokenId links a spent token to its
   successor so reuse (replay of an already-rotated or already-revoked token) can be
   detected and the whole family torn down — see usp_RefreshToken_Rotate. */
IF OBJECT_ID('dbo.RefreshToken') IS NULL
CREATE TABLE dbo.RefreshToken (
    TokenId          INT IDENTITY PRIMARY KEY,
    AccountId        INT           NOT NULL REFERENCES dbo.UserAccount(AccountId),
    TokenHash        VARBINARY(32) NOT NULL UNIQUE,
    IssuedOn         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresOn        DATETIME2     NOT NULL,
    RotatedToTokenId INT           NULL REFERENCES dbo.RefreshToken(TokenId),
    RevokedOn        DATETIME2     NULL,
    RevokedReason    NVARCHAR(100) NULL,   -- 'rotated' | 'reuse detected' | 'sign-out' | ...
    DeviceHint       NVARCHAR(120) NULL,
    IpAddress        NVARCHAR(45)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RefreshToken_Account')
    CREATE INDEX IX_RefreshToken_Account ON dbo.RefreshToken(AccountId) WHERE RevokedOn IS NULL;
GO
