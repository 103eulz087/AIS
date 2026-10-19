/* ============================================================================
   First-login guided tours (2026-10-19).

   A new member is walked through the app step by step the first time he signs in
   ("ais-welcome"); a council officer gets the same for the Portal ("portal-welcome").
   Whether he has finished — or skipped — a tour is kept HERE, per member, not in the
   browser, so changing phones or clearing the browser never replays it, and a member
   who skipped it on one device isn't chased by it on another.

   dbo.Tutorial is the catalogue of tours. The steps themselves live in the web app (they
   point at screens and buttons); the app sends the version of the steps it showed, so a
   tour that is rewritten later (higher version) is offered once more to everyone who
   only saw the old one. "Take the tour again" from Profile/the Portal menu just runs it;
   finishing it again only moves the recorded version/date forward.

   dbo.MemberTutorial: one row per (member, tour) — the latest finish. Every write goes
   through usp_MemberTutorial_Finish, which audits it (invariant #10).
   ============================================================================ */

IF OBJECT_ID('dbo.Tutorial') IS NULL
CREATE TABLE dbo.Tutorial (
    TourKey     NVARCHAR(40)  NOT NULL PRIMARY KEY,
    DisplayName NVARCHAR(80)  NOT NULL,
    IsActive    BIT           NOT NULL DEFAULT 1
);
GO
INSERT dbo.Tutorial (TourKey, DisplayName)
SELECT v.TourKey, v.DisplayName
FROM (VALUES (N'ais-welcome',    N'Welcome to the app'),
             (N'portal-welcome', N'Welcome to the Council Portal')) AS v(TourKey, DisplayName)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Tutorial t WHERE t.TourKey = v.TourKey);
GO

IF OBJECT_ID('dbo.MemberTutorial') IS NULL
CREATE TABLE dbo.MemberTutorial (
    MemberId     INT           NOT NULL REFERENCES dbo.Member(MemberId),
    TourKey      NVARCHAR(40)  NOT NULL REFERENCES dbo.Tutorial(TourKey),
    TourVersion  INT           NOT NULL,
    Outcome      NVARCHAR(10)  NOT NULL,
    FinishedDate DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_MemberTutorial PRIMARY KEY (MemberId, TourKey),
    CONSTRAINT CK_MemberTutorial_Outcome CHECK (Outcome IN (N'Completed', N'Skipped')),
    CONSTRAINT CK_MemberTutorial_Version CHECK (TourVersion >= 1)
);
GO
