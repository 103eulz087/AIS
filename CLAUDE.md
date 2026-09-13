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
| 10 | **Every write is audited.** `AuditLog` is written by the interceptor, not by feature code. | `AuditInterceptor` |
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
2. **`getUserMedia` requires HTTPS.** Local dev must run over the dev certificate, or the camera is dead.
3. **Never name a top-level browser binding `top`, `name`, `status`, `self`, `parent` or `length`.**
   They collide with non-configurable `window` properties and kill the whole script before it runs.
4. **The escalation clock counts working days**, respecting Philippine public holidays. See
   `db/seed/03_holidays.sql`.
5. **Approval is atomic.** Renewal approval writes member status, regenerates credentials, issues
   seals and the receipt, and audits — all in one transaction, or none of it.
6. **`SET NOCOUNT ON`** at the top of every stored procedure, or Dapper row counts lie.

---

## 9. Commands

```bash
scripts/dev.sh              # SQL Server in Docker, deploy schema, seed, run API + web
scripts/db-deploy.sh        # schema → procs → seed, in order, idempotent
dotnet build Akrho.sln
dotnet test
cd src/web && npm run dev   # Vite on :5173, proxying /api to :5080
cd src/web && npm run smoke # jsdom route smoke test
```

Slash commands: `/new-module`, `/review`, `/ship`.
