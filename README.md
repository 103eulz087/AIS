# AKRHO Information System & Central Portal

Two applications, one database, one organization.

- **AIS** — the chapter's system. Members, meetings, funds, receipts, digital ID. A PWA that
  installs on Android and iPhone.
- **Central Portal** — the councils' system. Annual renewal of chapters and members.

The specification is `docs/AIS-Project-Documentation.md`. The agreed design is
`docs/AIS-Mockup.html` and `docs/AIS-Portal-Mockup.html` — open them in a browser.

---

## Getting started

**Prerequisites:** .NET 8 SDK, Node 20+, Docker Desktop.

```bash
bash scripts/dev.sh
```

That starts SQL Server in Docker, deploys the schema, procedures and seed data, trusts the
ASP.NET dev certificate, and restores both projects. Then, in two terminals:

```bash
dotnet run --project src/Akrho.Api    # https://localhost:5443/swagger
cd src/web && npm run dev             # https://localhost:5173 (HTTPS once scripts/dev.sh has exported the dev cert — see CLAUDE.md §8.2)
```

In VS Code: **Run → API + Web**, or the *definition of done* task to run every check.

> **The dev certificate is not optional.** `getUserMedia` — and therefore all QR scanning —
> requires a secure context, and so does PWA installation. Without HTTPS the camera is dead.

---

## Layout

```
CLAUDE.md          working agreement — read this before changing anything
docs/              specification and the agreed mockups
.claude/           agent team, skills and slash commands for Claude Code
db/schema/         table DDL, numbered, idempotent
db/procs/          one stored procedure per file — ALL data access goes through these
db/seed/           reference data, demo chapter, holidays, renewal period
src/Akrho.Domain/  entities and domain rules. Depends on nothing.
src/Akrho.Infrastructure/  Dapper repositories, scope guard, auth
src/Akrho.Api/     endpoints, DTOs, validation
src/Akrho.Tests/   xUnit
src/web/           React PWA — AIS and the Portal
scripts/           dev bootstrap and database deploy
```

---

## The ten invariants

These are in `CLAUDE.md` §2 in full. In short:

1. The ledger is append-only. Corrections are reversing entries.
2. Corrective actions are never deleted.
3. Receipt numbers are never reused.
4. Every query is scoped — never trust a `chapterId` from a request body.
5. Contributions are voluntary. Never compute arrears.
6. Corrective action narratives go to officers and the member concerned only.
7. Cross-chapter member data is name, chapter, status only.
8. QR tokens contain no personal data.
9. Commemorative year cards are never verifiable — only the digital ID proves currency.
10. Every write is audited.

Items 1, 2 and 3 are enforced by database triggers, not by convention. They will fail loudly.

---

## Definition of done

```bash
dotnet build Akrho.sln --warnaserror
dotnet test
cd src/web && npm run build && npm test && npm run smoke
```

`npm run smoke` mounts every route in a DOM and asserts it renders without console errors.
**It is never skipped.** Twice during design a one-token mistake took down a whole page, and
neither was visible to linting or to a syntax check — a parse check is not a load check.

---

## Working with Claude Code

The team is defined in `.claude/agents/`: `tech-lead`, `database`, `backend`, `frontend`,
`tester`, `devops`. Skills in `.claude/skills/` cover writing a stored procedure, adding an API
feature, building a screen, and running the smoke harness.

```
/new-module meetings     plan and build a module end to end, delegating in order
/review                  check the working tree against the invariants
/ship                    run the definition of done and prepare for deployment
```

---

## Status

Scaffold. What exists and runs:

- Full schema for organization, members, meetings, money, discipline, communications,
  identity and the renewal module — with append-only triggers in place
- Stored procedures for member search, ledger read and reverse, attendance save,
  renewal submit and approve, the council subtree, and the working-day escalation clock
- API: health, member search (with the two-shape visibility rule), ledger read and reverse
- Web: member directory and ledger screens, design tokens, formatting, the smoke harness
- Tests: membership year, money splitting and amount-in-words, scope guard

Not yet built — see the phase table in `docs/AIS-Project-Documentation.md` §9:
auth endpoints, registration and approval, meetings UI, announcements and memos, expenses
and donations, corrective actions, dashboard, chat, QR scanning, and the Portal screens.
