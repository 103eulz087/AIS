# CLAUDE.md — AKRHO Information System & Central Portal

You are working on the information system of **Alpha Kappa Rho (AKRHO), Philippines**: a fraternal
organization with a government-like council structure. Two applications share one database.

Read `docs/AIS-Project-Documentation.md` before any non-trivial task. It is the specification.
This file is the working agreement — how we build, what must never be broken, and who does what.

---

## 1. The two systems in one sentence each

- **AIS** (`src/web`, `src/Akrho.Api`) — the chapter's system. Every member of a chapter sees the
  same books: meetings, funds, expenses, receipts, running balance. Installable on Android and iPhone as a PWA.
- **Central Portal** (`src/web`, route prefix `/portal`) — the councils' system. Annual renewal of
  chapters and members, with a fee, an approval chain, and an escalation clock.

**The chapter is the unit of data ownership.** AIS owns member records. The Portal reads them and
writes back a renewal result. Nothing is ever re-keyed in two places.

---

## 2. Non-negotiable invariants

These are not preferences. Breaking one is a defect even when a test passes and the client asked for it.
If a task appears to require breaking one, **stop and raise it** rather than implementing it.

| # | Invariant | Where it bites |
|---|---|---|
| 1 | **`LedgerEntry` is append-only.** No `UPDATE`, no `DELETE`, ever. A mistake is corrected by inserting a reversing entry that references the original. | `db/procs/Ledger_*.sql`, `LedgerRepository` |
| 2 | **`CorrectiveAction` is never deleted.** Status changes only; amendments append to `CorrectiveActionUpdate`. | Discipline module |
| 3 | **`AckReceipt` numbers are never reused.** A mistake is voided with a reason and a countersignature. There is no delete for any role, including sysadmin. | Portal renewal |
| 4 | **Every query is scoped.** A read or write must be filtered by the caller's permitted chapter/council subtree. Never trust a `chapterId` from the request body. | `IScopeGuard` — use it, do not bypass it |
| 5 | **Contributions are voluntary.** Never compute, store, display or infer arrears. A zero or blank contribution is normal and carries no penalty. | Meetings, dashboards, renewal |
| 6 | **Corrective action narratives are restricted.** All members see name, category, status, date. The `Content` field goes only to officers and the member concerned. | `CorrectiveActionDto` must have two shapes |
| 7 | **Cross-chapter member data is name, chapter, status only.** No contact details, no blood type. | Directory search |
| 8 | **The QR token contains no personal data.** Opaque credential id, chapter code, member number, status, iat, exp. Never `MemberId`, never a name. | `CredentialService` |
| 9 | **A commemorative year card is never verifiable.** No QR, no verification endpoint. Only the digital ID proves currency. | Recognition module |
| 10 | **Every write is audited.** `AuditLog` is written inside the same transaction as the write it records — by the stored procedure, not by feature code reaching around it. (Originally planned as an HTTP-level interceptor; that was never built, and the procedure-level pattern shipped in Auth slice 1 — `usp_Enrolment_Redeem`, `usp_RefreshToken_Rotate`, `usp_Auth_RecordSignInResult` — is stronger anyway: it is atomic with the write and sees outcomes an interceptor cannot, such as *why* a sign-in failed. Continue this pattern; do not add a parallel interceptor.) | Every write proc — see `usp_Enrolment_Redeem.sql` for the pattern |
| 11 | **One deployment, one URL, one database.** A chapter is a row in `dbo.Chapter`, never a site or an app pool. The chapter comes from the JWT, never from the hostname or the request body. | Everywhere |
| 12 | **A body cannot be registered before the body above it.** National → Regional → Provincial → City → Chapter → Member. Each level approves the one beneath. | Portal registry |
| 13 | **Members are created by chapters only** — as founding officers on a chapter registration, or by sign-up approved by a Chapter Admin. **No council may enrol anybody**, and no procedure that lets one may ever be added. | `dbo.Member` |
| 13a | **Approvals route to the nearest existing ancestor with seated officers.** Bootstrap, dormancy and delay are all cases of this one rule — never build a second mechanism for any of them. | `usp_Approval_ResolveApprover` |
| 13b | **A council requires at least one registered chapter in its jurisdiction before it can be created**, and its officers are selected from that jurisdiction. Seating from outside is permitted but written to `SeatOverride` — no waiver, no approval step, just a permanent record. | `usp_Council_Create`, `usp_Council_SeatOfficer` |
| 14 | **A member's home of record is a chapter OR a council, never both and never neither.** `HomeCouncilId` is a transition applied to an existing member whose chapter went dormant — never a creation path. Enforced by `CK_Member_Home`. | `dbo.Member` |
| 15 | **Councils and chapters are never deleted.** A reorganised jurisdiction has its chapters reassigned and the old council row stays, marked Dissolved. Every renewal and receipt beneath it references that row forever. | Portal registry |
| 16 | **Passwords are never transmitted.** Access is granted by a one-time enrolment link tied to a mobile number; the officer sets his own password and enables 2FA. Accounts are never shared or inherited at officer turnover. | Auth, chapter registration |

---

## 3. Stack and conventions

```
Backend    ASP.NET Core 8, C# 12
Data       SQL Server + Dapper over stored procedures. NO EF Core, NO inline SQL in C#.
Frontend   React 18 + TypeScript + Vite, PWA (vite-plugin-pwa)
Realtime   SignalR
Auth       ASP.NET Core Identity + JWT (access + refresh). 2FA required for officer roles.
Tests      xUnit (API), Vitest (web), Playwright-style smoke via jsdom harness
Host       On-premise Windows Server, IIS in front of Kestrel
```

### Hard rules

- **All data access goes through a stored procedure.** No `SELECT` string in C#. If you need a new
  query, write a proc in `db/procs/` first. Naming: `usp_<Entity>_<Action>.sql`.
- **Money is `DECIMAL(18,2)`.** Never `FLOAT`, never `double`. In C# use `decimal`.
- **Dates that mean "a day" are `date`.** Timestamps are `datetime2` and stored UTC; the client
  renders Asia/Manila.
- **The membership year runs 09 August → 08 August** and is named by the year it opens.
  `RenewedThrough` is always an 8 August date.
- **Currency is PHP.** Format `₱1,234.56`. There is no multi-currency.
- Async everywhere. `CancellationToken` on every I/O method.
- One feature = one folder under `src/Akrho.Api/Features/<Feature>/`.

### Naming

| Thing | Convention | Example |
|---|---|---|
| Table | PascalCase singular | `MeetingAttendance` |
| Stored proc | `usp_<Entity>_<Action>` | `usp_Member_Search` |
| C# feature folder | PascalCase | `Features/Members/` |
| Endpoint | kebab plural | `GET /api/members`, `POST /api/renewals/{id}/approve` |
| React component | PascalCase file | `MemberDirectory.tsx` |
| React route | kebab | `/members`, `/portal/renewal` |

---

## 4. Repository map

```
CLAUDE.md                  this file
docs/                      the specification — read before building
docs/SESSION-HANDOFF.md    if it exists and isn't empty: READ IT FIRST. A running note
                           for continuity between sessions/machines — what's uncommitted,
                           what's undeployed, open decisions. Not part of the permanent
                           spec; trimmed back down once its contents are committed/shipped.
.claude/agents/            the team (see §5)
.claude/skills/            repeatable procedures
.claude/commands/          slash commands
db/schema/                 table DDL, numbered, idempotent
db/procs/                  one stored procedure per file
db/seed/                   reference data + a demo chapter
src/Akrho.Domain/          entities, enums, domain rules. No dependencies.
src/Akrho.Infrastructure/  Dapper repositories, auth, audit, storage
src/Akrho.Api/             endpoints, DTOs, validation, SignalR hubs
src/Akrho.Tests/           xUnit
src/web/                   React PWA — AIS + Portal
scripts/                   db-deploy, smoke, dev bootstrap
```

---

## 5. The team

Delegate. Do not do everything in one context. Agents live in `.claude/agents/`.

| Agent | Use it for |
|---|---|
| `tech-lead` | Breaking a feature into tasks, reviewing a design against the invariants, deciding trade-offs, sequencing work |
| `database` | Schema changes, stored procedures, indexes, query plans, migrations |
| `backend` | Endpoints, DTOs, validation, repositories, auth, SignalR |
| `frontend` | React screens, PWA behaviour, offline, the design system |
| `tester` | Test plans, xUnit and Vitest tests, the jsdom smoke harness, regression checks |
| `devops` | CI, IIS deployment, TLS, backups, environment configuration |

**Sequence for a new module:** `tech-lead` plans → `database` writes schema + procs → `backend`
writes endpoints → `frontend` writes screens → `tester` covers it → `devops` ships it.
Run `/new-module <name>` to start that chain.

---

## 6. Definition of done

A change is not done until all of these are true:

- [ ] The relevant stored procedure exists in `db/procs/` and is idempotent (`CREATE OR ALTER`)
- [ ] `dotnet build` succeeds with zero warnings
- [ ] `dotnet test` passes
- [ ] `npm run build` succeeds in `src/web`
- [ ] `npm run smoke` passes — every route mounts in a DOM with no console errors
- [ ] No invariant in §2 is weakened
- [ ] Scoping is enforced through `IScopeGuard`, not by trusting the request
- [ ] Money uses `decimal` / `DECIMAL(18,2)`
- [ ] New user-visible strings are plain English, not developer shorthand

**The smoke test is not optional.** During design, two separate single-token mistakes took down an
entire page, and neither was visible to linting or to server-side syntax checking. A route that
throws on load is a dead feature.

---

## 7. Domain vocabulary

Use these words in code, comments and UI. Do not invent synonyms.

| Term | Meaning |
|---|---|
| **Chapter** | Barangay-level unit. Where records are created |
| **Council** | City/Municipal → Provincial → Regional → National. A self-referencing tree |
| **Gift name** | A brother's name within the organization (e.g. TANGLAW). Displayed more prominently than his legal name |
| **Date survive** | The date he was initiated |
| **Master initiator** | The brother who initiated him |
| **Renewed / Lapsed / Exempt** | The three annual renewal states. **Lapsed is not disciplinary** |
| **Corrective action** | A disciplinary record. Never deleted |
| **Year seal** | The brass mark on a digital ID for a renewed year |
| **Commemorative card** | The collectible for a renewed year. A keepsake, never proof of standing |
| **Override** | A higher council approving in place of one that did not act within its window |
| **Officer roster** | The eight offices on the chapter registration form: President, Vice President, Secretary, Treasurer, Auditor, and Master Initiators I–III. The Auditor is read-only; the Master Initiators are recorded with no login |
| **Approval routing** | The rule that an application is approved by the nearest existing ancestor with seated officers. Covers normal operation, bootstrap, dormancy and delay |
| **Seat override** | A council officer seated from outside the council's jurisdiction. Permitted and logged; never waived or approved |
| **Detached member** | An existing member whose chapter went dormant or was dissolved. Created by a chapter, later re-homed to a council. Counts toward no chapter's numbers |
| **Dormant council** | A council with no seated officers. It is still the approving body for everything beneath it, so dormancy blocks renewals until it is reconstituted |
| **Enrolment link** | The one-time, 72-hour link that grants an officer his account. Not a password |
| **Chapter mark** | A chapter's logo or generated monogram, plus an accent from six approved colours. Primary in the app, secondary on the ID, absent from the login page and the public verification page |

**Tone in user-facing text:** plain, warm, direct. This is read by barangay-level members on cheap
Android phones, many of them not in tech. No jargon. Filipino terms where they are natural.

---

## 8. Things that will trip you up

1. **iOS Safari has no `BarcodeDetector`.** QR scanning needs the `zxing-wasm` fallback. Do not
   remove it because "the API exists" — it exists on Chrome only.
2. **`getUserMedia` requires HTTPS — and so does the session cookie.** The refresh-token
   cookie is `Secure`, so a browser will not store it on a page served over plain HTTP,
   regardless of what scheme the API used. Local dev must run over the dev certificate on
   **both** the API and the Vite dev server (`scripts/dev.sh` exports it to
   `src/web/.certs/dev-cert.pfx` for Vite to pick up), or the camera is dead and sign-in
   silently never persists.
3. **Never name a top-level browser binding `top`, `name`, `status`, `self`, `parent` or `length`.**
   They collide with non-configurable `window` properties and kill the whole script before it runs.
4. **The escalation clock counts working days**, respecting Philippine public holidays. See
   `db/seed/03_holidays.sql`.
5. **Approval is atomic.** Renewal approval writes member status, regenerates credentials, issues
   seals and the receipt, and audits — all in one transaction, or none of it.
6. **`SET NOCOUNT ON`** at the top of every stored procedure, or Dapper row counts lie.
7. **A bare `CASE WHEN ... THEN 1 ELSE 0 END` in a proc's `SELECT` infers `INT`, not `BIT`.** If
   that column feeds a C# record's `bool` property, Dapper can't find a matching constructor and
   the endpoint 500s with no useful client-side message (`ExceptionHandling.cs` never leaks
   exception detail — check the day's file in `src/Akrho.Api/logs/` for the real exception).
   Always `CAST(CASE WHEN ... THEN 1 ELSE 0 END AS BIT)` when the target is `bool`. Found live in
   `usp_ChapterRegistration_GetQueue`'s `CanAct` column; every other proc using this pattern
   already casts correctly or feeds an `int` count, not a `bool`.
8. **If Vite was ever started without the dev cert present, restarting it is not enough.** The old
   plain-HTTP process can linger and hold port 5173, so the new run falls back to 5174 — and the
   API's `Cors:Origins` / `Web:Origin` (`appsettings.json`) are hardcoded to `5173`, so API calls
   and any already-issued enrolment links silently break. After exporting the cert
   (`dotnet dev-certs https --export-path src/web/.certs/dev-cert.pfx -p devcert --trust` — this
   pops a Windows trust dialog, it's not headless), confirm port 5173 is actually free before
   trusting the URL Vite prints.
9. **Council creation/seating has no UI or API yet** — only `db/procs/usp_Council_Seating.sql`,
   called the same raw-SQL way `db/seed/02_demo_chapter.sql` seats Sta. Rosa City Council. Until
   that module ships, testing anywhere outside the seeded Laguna chain means seating a council by
   hand the same way. Two consequences worth knowing going in:
   - `dbo.Chapter` has **no region/province/municipality columns of its own** — the public
     `/apply` picker (`usp_Chapter_ListPublic`) infers them by walking the chapter's council
     parent chain. A chapter bootstrapped straight under National (because no lower council
     exists yet) resolves all three as `NULL` and **cannot appear in that picker** until a real
     council chain is seeded above it and the chapter is reparented (`Chapter.ParentCouncilId`).
     The chapter's *actually chosen* geography survives on its `ChapterRegistration` row
     (`RegionId`/`ProvinceId`/`MunicipalityId`) — use that as the source of truth when seeding the
     missing chain, don't guess.
   - Seating a council by hand still needs a real member to seat. Prefer an existing member whose
     role is unused elsewhere; `db/seed/02_demo_chapter.sql`'s own header comments flag
     `AKR-04-0117-002`/`-003` as relied on by several xUnit fixtures to stay role-less — don't
     seat those two on the shared dev DB.
10. **IIS hosts the API as a nested Application aliased `backend`, never `api`.** IIS strips a
    nested Application's own alias as its `PathBase` before the request ever reaches the app —
    but every route in `Akrho.Api` already has a literal `/api/` prefix baked in (§3's own
    endpoint convention), so an Application aliased `api` would see `/api/regions` arrive as just
    `/regions` and 404 on every single request. The root site's own `web.config`
    (`src/web/staging.web.config`) carries an "API passthrough" rewrite rule that rewrites
    `/api/...` to `/backend/api/...` first, specifically to route around this. If a fresh
    environment 404s on every API call with an empty response body and `X-Powered-By: ASP.NET`
    even though the app runs fine standalone, this is almost always why — check the Application's
    alias and the site's own physical path (see next item) before anything else.
11. **A staging/production IIS site's own physical path must be the folder that holds
    `index.html` — never the `\api` subfolder.** Point it one level too deep and IIS serves
    everything, `/` included, straight out of the API's own folder — which happens to still
    "work" for `/` (a coincidental static-file hit) while every real frontend route 404s with an
    empty body, misleading anyone debugging it into suspecting the rewrite rules instead.
    `Get-Website | Format-Table Name, PhysicalPath` is the one-line way to confirm this is right.
12. **Photo storage is local disk, per deployment, never shared** — only the database is shared
    across environments (e.g. local dev and staging pointed at the same `corex.itcoreapps.com` dev
    DB). A photo uploaded on one environment exists in `dbo.Member.PhotoPath` on the shared DB but
    not on the other environment's disk at all. Any code that reads a member's photo by that path
    (`IdCardExportEndpoints` included) must treat a missing file as "no photo," not as an error —
    this is not a bug to chase, it is the expected shape of sharing one DB across environments.
13. **Redeploying the API's IIS folder must never blindly mirror/replace it wholesale.**
    `uploads/` (member photos) and `logs/` hold real runtime data with no counterpart in a fresh
    `dotnet publish` output — a full mirror copy (`robocopy /MIR` or "replace everything") silently
    deletes both. Copy application files only: `robocopy <publish output> <site path> /E /XD
    uploads logs`, or merge-not-replace if copying by hand.
14. **`npm ci` can fail with `EPERM .../esbuild.exe`** if a local `npm run dev` is still running
    (it holds that binary open) — stop it first. If it recurs with nothing else running, this repo
    lives inside a Google Drive–synced folder (`D:\MYGDRIVE\...`); Drive's sync client can
    transiently lock the same file mid-sync. Pause sync and retry.
15. **A proc that mints a `dbo.MemberCredential` row must revoke any existing un-revoked row for
    that member FIRST**, even one that only *expired* rather than being deliberately revoked.
    `UX_MemberCredential_Member_Live` is a filtered unique index on `RevokedDate IS NULL` — SQL
    Server filtered indexes can't reference `SYSUTCDATETIME()`, so "not yet revoked" and "not yet
    expired" must be kept the same thing by every writer, not two different conditions, or the
    INSERT fails. See `usp_Credential_GetOrIssueForSelf`'s and `usp_Credential_BulkIssueForExport`'s
    own "supersede a stale row" comments before adding a third way to issue one.

---

## 9. Commands

```bash
scripts/dev.sh                        # SQL Server in Docker, deploy schema, seed, restore both projects
scripts/db-deploy.sh                  # schema → procs → seed, in order, idempotent

dotnet run --project src/Akrho.Api    # https://localhost:5443/swagger (also http://localhost:5080)
dotnet build Akrho.sln --warnaserror  # matches CI; warnings-as-errors is also on by default (Directory.Build.props)
dotnet test                           # all xUnit tests
dotnet test --filter "FullyQualifiedName~MembershipYearTests"   # one test class
dotnet test --filter "FullyQualifiedName~MoneyTests.SplitsWithoutLosingCentavos"  # one test

cd src/web && npm run dev             # Vite on https://localhost:5173 (needs src/web/.certs/dev-cert.pfx — see §8.2), proxying /api to :5443
cd src/web && npm run build           # tsc -b && vite build
cd src/web && npm run lint            # tsc --noEmit
cd src/web && npm test                # vitest, all specs except the smoke harness
cd src/web && npx vitest run src/shared/format.test.ts   # one spec file
cd src/web && npm run smoke           # jsdom route smoke test — every route must mount clean

scripts/build-for-staging.ps1         # builds API (Staging env) + web app locally into .\publish\api and .\publish\web,
                                       # ready to copy onto the staging IIS server — see §8.10-14 before redeploying
```

The full definition of done (§6), also what CI (`.github/workflows/ci.yml`) runs:

```bash
dotnet build Akrho.sln --warnaserror && dotnet test
cd src/web && npm ci && npm run lint && npm run build && npm test && npm run smoke
```

Slash commands: `/new-module`, `/review`, `/ship`.

---

## 10. Shared development/test database

There is a shared SQL Server for development and testing when Docker/local SQL Server isn't
available:

```
Server    corex.itcoreapps.com,6601
Database  AISDB
```

**Never put the password for this server in a file tracked by git — not here, not in
`appsettings.*.json`, not in a script.** This file is checked into the repository; anyone who
clones it, or looks at its history, would get the credential permanently. Get the password from a
teammate or the team's password manager, then supply it one of two ways:

- As an environment variable when running the API, e.g.
  `ConnectionStrings__Akrho="Server=corex.itcoreapps.com,6601;Database=AISDB;User Id=...;Password=...;TrustServerCertificate=True;Encrypt=True" dotnet run --project src/Akrho.Api`
- Or in `src/Akrho.Api/appsettings.Development.local.json` — already gitignored
  (`appsettings.*.local.json`), safe to keep the connection string there for repeat local runs.

`scripts/db-deploy.sh` already reads `AKRHO_SQL_SERVER` / `AKRHO_SQL_USER` /
`AKRHO_SQL_PASSWORD` / `AKRHO_DB` from the environment, so it can be pointed at this server the
same way instead of the Docker default.

The `sqlcmd` bundled with some local SQL Server client tool installs defaults
`QUOTED_IDENTIFIER` to `OFF`, which fails on the filtered indexes in `db/schema/02_members.sql`.
Pass `-I` to enable it if you run `sqlcmd` directly instead of through `db-deploy.sh`.

---

## 11. Staging server

```
Site               http://itcoreapps.com:1973   (HTTPS not set up yet — plain HTTP for now)
IIS site name      akp-staging-api
Site physical path C:\inetpub\Akp-Staging              (the WEB APP root — NOT \api, see §8.11)
API app path       C:\inetpub\Akp-Staging\api           (a nested IIS Application aliased "backend", never "api" — §8.10)
API app pool       akp-staging-api                      (its own pool, separate from the site's own — §8's "common mistake")
Database           SAME shared dev DB as §10 (corex.itcoreapps.com / AISDB) — a schema/proc change deployed
                    once is already live for staging; there is no separate staging database to update.
```

Four environment variables live on the `akp-staging-api` application pool (IIS Manager → Application
Pools → that pool → Advanced Settings → Environment Variables) — never in any file:
`ConnectionStrings__Akrho`, `Jwt__SigningKey`, `Push__VapidPrivateKey`, `Push__VapidPublicKey`. The
API refuses to start at all without the latter three outside Development (`Program.cs`'s own
placeholder guards) — see §8.10-14 for what actually goes wrong when any of this drifts.

**Known problem, not yet fixed:** `src/Akrho.Api/appsettings.json`'s `ConnectionStrings:Akrho` is
currently the real §10 password, committed in plain text — exactly what §10's own rule above
forbids. Needs the password rotated and the committed value replaced with a placeholder; flagged
here so it isn't lost.

Deploy process: `scripts/build-for-staging.ps1` locally, then copy `publish\web\*` and
`publish\api\*` onto the server (excluding `uploads/`/`logs/` from the API copy — §8.13), recycling
the `akp-staging-api` pool around the API copy. No IIS reconfiguration needed for an ordinary code
change — site bindings, the pool, the `backend` alias, and the four environment variables above are
untouched by a redeploy.
