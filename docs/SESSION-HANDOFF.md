# Session Handoff

**Read this file first if you are picking this project back up in a new Claude Code
session** — especially on a different machine (e.g. switching from Windows to a Mac).
This is not part of the permanent spec; it's a running note for continuity between
sessions, kept up to date as work progresses. Once everything below is committed and
deployed, this file should be trimmed back down to near-empty rather than left to
accumulate as a permanent changelog — `git log` is the permanent record; this is a
temporary bridge.

**Last updated:** 2026-09-21

---

## ⚠️ The one fact that matters most: nothing here is committed yet

`git status` at the time of writing shows a very large number of modified and new files
— **none of it has been committed to git**. Everything described below is sitting as
working-tree changes only. If you're on a new machine and the project folder is synced
via Google Drive, the files themselves should already be there (Drive syncs raw file
contents regardless of git status) — but confirm with `git status` before assuming
anything, and don't run any destructive git command (`checkout .`, `reset --hard`,
`clean -f`) without checking first, per this repo's own CLAUDE.md safety rules.

**Nothing built this session has been deployed to the staging IIS server yet either.**
The last confirmed-working staging deploy was 2026-09-17 (sign-in, chapter registration,
council approval, National ID Card Export). Everything from this session (see below) is
only live on the **shared dev/staging database** (`corex.itcoreapps.com,6601` /
`AISDB` — CLAUDE.md §10/§11), not on the actual staging site
(`http://itcoreapps.com:1973`) or its API. A `build-for-staging.ps1` + copy + IIS pool
recycle is still needed before any of this is visible there.

---

## What was built this session (chronological, database-first as always)

All database changes below are **already deployed live** to the shared dev/staging DB —
confirmed idempotent, confirmed working via direct live testing (not just unit tests) for
every item. The application code (API + web) implementing them is **not yet deployed**
anywhere beyond your local machine.

1. **Mobile-number sign-in** — a member can sign in with either member number or mobile
   number (`usp_Auth_GetAccountForSignIn`).
2. **Dry-run default password** — newly-approved members get immediate access via a
   shared default password (`Akrho.Infrastructure.Security.DryRunDefaults`), a
   deliberate, explicitly time-boxed weakening of invariant #16 — user said "I will just
   tell you if we harden the security soon." Not yet reverted.
3. **Self-service password change** and **expanded self-editable profile fields**
   (gift name, birthdate, date survive, president/master-initiator during survive).
4. **The chapter join-link/QR code feature** — a Chapter Admin generates a permanent
   link/QR (`/invite` screen) that pre-fills the public sign-up form for that specific
   chapter (`/j/:token`), additive alongside the existing manual region/province/city
   picker. Permanent by design until deliberately regenerated (user's own decision).
5. **A major, previously-unknown, app-wide bug fix**: `toApiError()` in
   `src/web/src/shared/api.ts` was silently discarding most backend rejection messages
   (only checked `.title`, never a bare string body or `.detail`) — affected error
   messaging across the *entire app*, not just the one screen it was found on.
6. **Council Statistics module** (`/portal/statistics`) — council-to-council,
   council-to-chapter, chapter-to-member rollups for council officers, including a
   **financial rollup** (aggregate per-chapter balances only, never transaction-level
   detail). This required and got an explicit, dated amendment to a recorded client
   decision (`docs/AIS-Project-Documentation.md` §3/§10 Decision #7, amended
   2026-09-21) — read that amendment before touching anything financial in this area.
7. **Chapter registration officer roster relaxed** — only the President is required to
   petition for a new chapter; every other office is now optional and added
   progressively ("Add a position"), instead of forcing all 8 up front. Fixed a real
   latent bug in `usp_ChapterRegistration_Approve` along the way (it compared verified-
   officer count against a hardcoded 8, which would have made any partial roster
   permanently unapprovable).
8. **Member account actions — block / reset password** (National Council only, by
   explicit client decision) — a National-seated CouncilAdmin can disable a member's
   login or force a password reset (never transmitting a password itself — always a
   fresh one-time link, same invariant #16 discipline as everywhere else). New
   `/portal/blocked-members` review screen.
9. **Council registration and officer seating module** (`/portal/councils`,
   `/portal/councils/:councilId`) — the big one. Lets a real council seat its own
   officers through the app for the first time ever (previously only possible via a
   developer running raw SQL by hand — CLAUDE.md §8.9's long-documented gap). Authority
   to create a council or seat/unseat an officer routes through the *same* "nearest
   ancestor with seated officers" rule that already governs chapter-registration
   approval (invariant #13a) — no second mechanism. A lapsed member can't be seated; a
   never-renewed one can (otherwise nobody could ever be seated at go-live). Two real
   bugs were found and fixed only by testing live over HTTP, not just in raw SQL — see
   `db/procs/usp_Council_ResolveSeatingAuthority.sql`'s own header comment for the
   result-set-leak one, which is worth reading if you touch this area again.

## Decisions made this session (with their reasoning — don't re-litigate, but don't blindly
trust either without checking current code first)

- **National Council only** may block a member's login, reset a password, or seat/unseat
  a council officer anywhere — not any council within its own subtree. Deliberately
  narrow; see `usp_Enrolment_Issue.sql`'s own header for the "any council officer may
  manage any member's account, forever" concern this was designed to avoid.
- **Financial rollup is aggregate-only, per chapter, never transaction-level** — the
  amendment to Decision #7 says this explicitly; don't let it drift into a ledger-entry
  drill-down without a fresh, equally explicit decision.
- **A lapsed member (renewal overdue) cannot be seated as a council officer; a
  never-renewed member (no renewal season has run for him yet) can.**
- **Blocking/resetting/seating all require a typed reason**, recorded permanently, kept
  deliberately **out of** `dbo.CorrectiveAction` — these are account-access actions, not
  discipline.

## Open items nobody has answered yet

- **There is pre-existing, uncommitted work in the tree that was never discussed in this
  session**: an `IdCardExport` feature (API + Portal screen), `Verification`, and
  `Scan.tsx`/QR scanning, with their own tests — 3 of which (`IdCardExportZipBuildingTests`)
  are currently failing. This was flagged to the user once; they have not yet said
  whether to review/fix it or that they're already aware and it's fine as-is. Don't
  assume either way — ask again if it comes up.
- **Formal xUnit test coverage for the council-seating module** (scope-leak tests,
  structural invariant tests) was scoped but not yet written.
- **Nothing from this session has been deployed to staging.** See the warning at the top.
- A stray `ZZTEST-` fixture member (`MemberId 1305`) was found colliding with an
  existing test's fixed mobile number and flagged for cleanup
  (`scripts/cleanup-stray-zztest-member-1305.sql`) — not yet run (blocked by the auto-mode
  permission classifier on a direct DELETE; needs the user to run it).
- `appsettings.json`'s committed database password (the real shared-DB credential, in
  plain text, tracked by git) still needs rotating — flagged repeatedly across multiple
  sessions, never yet actioned.

---

## Switching to macOS — what changes, what doesn't

The **deployment target never changes** — staging is still the same Windows Server/IIS
box (`http://itcoreapps.com:1973`) regardless of what OS you develop on. Only your local
build/dev workflow differs.

**Works unchanged on Mac:**
- `dotnet build`, `dotnet test`, `dotnet publish` — the .NET SDK is fully cross-platform.
- `npm install` / `npm run build` / `npm test` / `npm run smoke` — identical.
- `scripts/dev.sh` and `scripts/db-deploy.sh` — already POSIX bash, should run as-is in
  Terminal (zsh/bash).
- `dotnet dev-certs https --trust` — works on Mac too, but trust goes through macOS
  Keychain instead of a Windows dialog; you may be prompted for your Mac password or
  Touch ID instead of the Windows trust popup CLAUDE.md §8.2 describes.

**Needs an adjustment:**
- **`scripts/build-for-staging.ps1`** is Windows PowerShell. Two options:
  1. Install PowerShell 7 (`brew install --cask powershell`, then run via `pwsh`) and
     run the script mostly as-is — **except** its two `robocopy` calls, which don't
     exist on Mac at all. Swap those two lines for `rsync -a --delete "$src/" "$dst/"`
     (or even a plain `cp -R`, since this script only copies *into* a local `.\publish\`
     folder, not onto the server) if you go this route. Ask me to make that swap for you
     if/when you're actually on the Mac and want it.
  2. Or skip the script entirely and just run its two real commands by hand:
     `dotnet publish src/Akrho.Api -c Release -o publish/api -p:EnvironmentName=Staging`
     and (`cd src/web && npm ci && npm run build`), then copy `src/web/dist` to
     `publish/web` yourself.
- **`scripts/publish-staging.ps1`** only ever runs *on the staging Windows server
  itself* (it uses the `WebAdministration` IIS PowerShell module to stop/start the app
  pool) — this was never something your dev laptop runs, Mac or Windows, so nothing
  changes here. You'll still need some way to get the built `publish/api` and
  `publish/web` folders onto that server (RDP + copy, or a network share, or SCP if
  that's enabled) and either run this script there or copy the files by hand per
  CLAUDE.md §8.13 (`uploads/` and `logs/` must never be overwritten by a mirror copy).
- **Local SQL Server in Docker** (what `scripts/dev.sh` spins up) may be awkward on
  Apple Silicon (M1/M2/M3) — Microsoft's SQL Server image is `amd64`-only and runs under
  Rosetta emulation, which can be slow or flaky. **Recommended instead: skip local
  Docker entirely and point at the shared dev/test database**
  (`corex.itcoreapps.com,6601` / `AISDB` — CLAUDE.md §10) via
  `ConnectionStrings__Akrho` or a gitignored `appsettings.Development.local.json`. This
  is already the documented fallback for exactly this situation ("when Docker/local SQL
  Server isn't available") and is simpler than fighting Docker on ARM.
- **`sqlcmd`** for direct SQL work isn't preinstalled on Mac. Install via Homebrew
  (`brew install sqlcmd` for the modern Go-based cross-platform tool, or Microsoft's
  `mssql-tools18` tap) — flag support differs slightly from the Windows/ODBC version, so
  check `sqlcmd -?` if a flag used in this session's own scripts doesn't work.

Ask me to actually do any of the above (write a Mac-friendly build script, walk through
`brew install` steps, etc.) once you're on the Mac and can verify things directly — I'm
listing what will need attention, not pre-solving problems I can't test from here.
