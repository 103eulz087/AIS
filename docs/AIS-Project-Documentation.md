# AKRHO Information System & Central Portal
## Consolidated Project Documentation — v2.0

**Client:** Alpha Kappa Rho (AKRHO), Philippines
**Prepared for:** Development team, client stakeholders, National Council review
**Supersedes:** AIS Project Documentation v1.1 and AKRHO Central Portal Module Specification v1.1. Both are folded into this document; do not work from the earlier versions.

---

## 1. Executive Summary

Two systems, one organization.

| | **AIS** — AKRHO Information System | **Central Portal** |
|---|---|---|
| Who uses it | Every member of a chapter | Seated officers of councils |
| What it owns | The chapter's records — members, meetings, funds, communications | The organization's processes — registration and annual renewal |
| Where it runs | Web + installable on Android and iPhone | Web, desktop-first, must work on a phone browser |
| Core purpose | Transparency within a chapter, and mutual aid between brothers | A single national register, and a renewal process that finishes |

**AIS** replaces the existing chapter system and expands it. Its premise is that every member of a chapter sees the same books: the same meeting records, the same fund collections, the same expenses and receipts, the same running balance. The membership itself becomes the audit body.

**The Central Portal** is new. It is where a chapter registers its members for the year, where a council approves that registration, and where the organization sees — for the first time — a count of active brothers that is a fact rather than a figure a chapter chose to report.

### Guiding principles

| Principle | Implication |
|---|---|
| Chapter-scoped by default | A member sees his own chapter's data. Anything beyond that is explicit and permissioned. |
| Transparency over secrecy | Financial records are visible to all chapter members, not only to officers. |
| Append-only where it matters | Ledger entries, corrective actions and receipts are never deleted. Corrections are amendments, not erasures. |
| Honest about uncertainty | Where the system cannot confirm something — an offline ID check, a stale sync — it says so rather than showing a confident green tick. |
| One source of truth | AIS owns member data. The Portal reads it and writes back a renewal result. Nothing is ever re-keyed. |
| Resource-efficient | No video hosting. Images compressed on upload. One codebase across three surfaces. |

---

## 2. Organizational Model

```
International
└── National Council (Philippines — National President)
    └── Regional Council
        └── Provincial Council
            └── City / Municipal Council
                └── Chapter (barangay level)   ← AIS operates here
                    └── Members
```

**Councils are modelled as a self-referencing tree,** not as five fixed tables: one `Council` table with a `ParentCouncilId` and a `CouncilLevelId`. This gives support for structures abroad that differ from the Philippine one, roll-up totals resolved by a recursive CTE, and no schema change when a tier is added or renamed.

```sql
WITH CouncilTree AS (
    SELECT CouncilId, ParentCouncilId, 0 AS Depth
    FROM   dbo.Council WHERE CouncilId = @RootCouncilId
    UNION ALL
    SELECT c.CouncilId, c.ParentCouncilId, ct.Depth + 1
    FROM   dbo.Council c
    JOIN   CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
)
SELECT ch.ChapterId
FROM   dbo.Chapter ch
JOIN   CouncilTree ct ON ch.ParentCouncilId = ct.CouncilId;
```

**Current scope is the Philippines only.** International chapters are out of scope for this engagement, but the model must not preclude them.

---

## 3. Roles and Permissions

Roles are **assignments with a scope**, never columns on the member record. A brother can be Treasurer of Chapter A and simultaneously hold a council office. Officer roles are **term-bound** (`TermStart`, `TermEnd`); when a term lapses the permissions drop automatically, because chapter leadership rotates.

### 3.1 AIS

| Role | Scope | Capabilities |
|---|---|---|
| Member | Own chapter | Directory, memos, announcements, meetings, expenses, donations, corrective actions, dashboard, chat. Edits own profile. Views and scans IDs. |
| Chapter Officer (Secretary) | Own chapter | Member CRUD, meetings, attendance and fund entry, announcements, memos. |
| Chapter Treasurer | Own chapter | Ledger, expenses, donations, receipt uploads. |
| Chapter Admin (President) | Own chapter | All of the above, plus registration approval, corrective actions, officer role assignment, chapter settings. |
| System Admin | Global | Account recovery, audit log access, configuration. **Cannot alter the ledger.** |

### 3.2 Central Portal

| Role | Scope | Capabilities |
|---|---|---|
| Chapter President | Chapter | Opens and submits the annual renewal, tracks it, views the acknowledgement receipt. |
| Chapter Treasurer | Chapter | Attaches proof of payment. |
| Council Secretary | City / Municipal | Verifies and approves or returns applications; issues receipts. |
| Council Treasurer | Any council | Posts fees received, records remittance upward. |
| Provincial Officer | Province | Monitors all councils beneath; may approve on override once the window lapses. |
| Regional Officer | Region | The same, one level higher. |
| National Secretariat | National | Configures the season, fee, split and escalation clock; may approve at any time; national reporting. |

**Council access to chapter financial records in AIS is switched off.** Per client decision, AIS is chapter-exclusive for now. The roll-up capability is built but disabled until the National Council decides otherwise.

---

## 4. AIS — Functional Requirements

### 4.1 Registration and approval

Registration is linked from the login page. Fields: first / middle / last name, birthdate, address, blood type, skills, profession, gift name, date survive, president during survive, master initiator during survive, photo, chapter (cascading Region → Province → City → Chapter), mobile number, email.

```
Registered → PendingApproval → Approved (may sign in)
                            ├→ ReturnedForCorrection (edits and resubmits)
                            └→ Rejected (with reason, notified)
```

**A seconder is required** — the applicant names an existing brother who confirms he knows him. The practical verification points (date survive, president, master initiator) rely on an admin's memory and do not scale; the seconder does, and it creates an accountability trail.

On approval: the member number is generated, the digital ID is issued, and sign-in is enabled.

**Member number format is new.** No existing national convention is being preserved. Proposed: `AKR-RR-CCCC-NNN` — region, chapter, sequence. The National Council is the issuing authority.

### 4.2 Member directory and search

The most-used member feature. Must be fast and usable one-handed.

- Filters: blood type, skill, profession, status, chapter.
- **Skills are a controlled tag list, not free text.** Free text produces "driver", "Driver", "drives", "can drive" and the filter is useless within a year. Seed a list; free entry may *suggest* a tag for admin approval.
- Result card: photo, gift name, real name, blood type, top skills, profession, tap to call or message.
- **Cross-chapter search shows name, chapter and status only** — no contact details, no blood type. Contact is made through the brother's own Chapter Admin.

### 4.3 Meetings and attendance

Meeting: subject/agenda, date, body, location, status (Draft / Finalized).

Attendance entry: a checklist of active members, checkbox plus an amount field per brother, with bulk actions. On save the total posts to the ledger as a **single Cash In entry** referencing the meeting.

**Contributions are voluntary.** This is a client decision with consequences throughout the system:

- No fixed dues amount is enforced; the chapter's suggested amount only pre-fills the sheet.
- **No arrears is ever computed** and no brother is flagged as owing.
- A blank or zero amount is normal and carries no penalty.
- Participation is reported as attendance percentage, never as a collection rate.

**Finalize locks the meeting.** Once finalized, attendance and amounts become read-only; later changes are recorded as adjustments with a reason and the editing officer's name. Without this the transparency guarantee is hollow.

Attendance statuses: Present, Late, Excused, Absent.

### 4.4 Announcements and memos

- **Announcement** — short, time-sensitive, push-notified on insert, optional expiry.
- **Memo** — formal, numbered (`MEMO-2026-001`), may carry a PDF, may cascade from a council above.

Both support title, rich-text body, attachments, scope, publish date, author, and **read receipts** so officers can see who has actually opened it. Unread members are reminded automatically after 48 hours.

### 4.5 Corrective actions

Fields: member, date filed, filed by, issue content, category, status (Pending / Under Review / Reconciled / Dismissed), resolution notes and date.

**No deletion, ever.** Status changes only. Amendments are appended to a `CorrectiveActionUpdate` child table so the history reads as a timeline.

**Visibility — Option B, per client decision.** All chapter members see the brother's name, the category, the status and the date. The written narrative is visible only to officers and to the brother concerned.

The reasoning matters for anyone tempted to relax it: an unproven allegation published in full to an entire chapter, permanently, is a defamation exposure and a data-privacy concern under RA 10173, which treats disciplinary records as sensitive personal information. Option B preserves awareness and keeps the dashboard case count meaningful while limiting permanent publication of detail.

### 4.6 Financials

**The ledger is the single source of truth for the balance.** Everything else posts into it.

```
Cash In  ← meeting collections, donations, other receipts
Cash Out ← expenses, remittances to the council
Balance  = SUM(CashIn) − SUM(CashOut)
```

- **Append-only.** A mistake is fixed by a reversing entry that stays visible beside the original, never by an edit.
- Every row carries `SourceType` + `SourceId` so any dashboard figure drills down to its origin.
- Amounts are `DECIMAL(18,2)`. Never `FLOAT`.

**Expenses:** date, activity, payee, description, amount, category, receipt attachments (multiple, at least one required), recorded by, approved by.

**Donations:** date, donor name, donor type (Government Official / Private / Member / Business), subject, purpose, cash amount or in-kind description, acknowledgement receipt number.

**Activity / Project is a first-class entity.** Expenses and donations both reference it, so the system can answer: *the Clean-Up Drive received ₱15,000 and spent ₱12,400 — here is the ₱2,600 remainder and the eight receipts.* This is the strongest transparency artifact the system produces and the page a donating official will ask to see.

### 4.7 Dashboard

Financial: funds collected, expenses, donations, current balance.
Membership: total, active, inactive, new this year.
Activity: meetings held, average attendance, corrective actions by status.

**Every tile drills down.** A figure nobody can open is not transparency. Date-range filtering; aggregates computed server-side in stored procedures, never in the client.

**Inactive status is set manually** by the Chapter Admin — there is no automatic rule based on missed meetings.

### 4.8 Landing page — video and chat

- **Video panel:** a YouTube URL only, rendered via iframe. No uploads, no transcoding, no storage cost.
- **Public chat:** chapter-wide room, real-time over SignalR.
- **Private chat:** one-to-one between members.

Requirements that are expensive to retrofit: paged history, report/flag with an officer moderation queue, mute, soft-delete (hidden from members, retained for review), rate limiting, push on private message and @mention, file sharing with size and type limits.

**Chat retention is 12 months,** then automatic purge.

**This is not end-to-end encrypted.** Transport is TLS and data is encrypted at rest, but officers and system administrators can access message content for moderation. Members are told this in the terms they accept at registration. Promising more security than is delivered is worse than promising none.

### 4.9 Digital ID

Front: photo, gift name, full name, member number, chapter, council chain, date survive, blood type, **year seal and validity line**.
Back: QR resolving to a public verification page, and the year's issue details.

**Validity runs to 8 August** — see §6.1. The card regenerates whenever status or renewal changes, so a suspended or lapsed card cannot be shown as current.

### 4.10 QR verification and scanning

The ID is only half the feature; the scanner that reads it is the other half.

| Surface | Who uses it | What is shown |
|---|---|---|
| In-app scan | Any signed-in member | Photo, gift name, real name, member number, chapter, status, blood type — subject to the same chapter / cross-chapter rules as the directory |
| Public verification page | Anyone with a plain phone camera — a hospital, an LGU official, a checkpoint | Photo, gift name, chapter, status. Four facts, nothing else. No app, no login |
| Attendance scan | Chapter Secretary | Marks the brother present in the open meeting |

**Token design.** The QR encodes a URL, `https://verify.<domain>/v/<token>`, so a phone's built-in camera resolves the card without the app installed. The token is a compact signed credential containing only:

```
sub  opaque credential id (NOT the MemberId — an internal id in a QR is a leak)
chp  chapter code
mno  member number
sta  status at time of issue
iat  issued at
exp  expiry (rolling, re-issued on sync)
```

**No name, no photo, no blood type, no address inside the token.** Everything displayed is fetched by the verifier under the verifier's own permissions — which is what stops a photographed QR from becoming a data leak.

**Offline verification.** Barangay halls have poor signal, and a check that only works online fails exactly when it is needed. The app verifies the signature locally against a cached public key and reports its confidence honestly:

| Result | Meaning |
|---|---|
| **Green — verified live** | Signature valid *and* the register queried just now |
| **Amber — verified offline** | Signature valid; status as of the device's last sync. A suspension issued since would not appear |
| **Red — not valid** | Signature mismatch, expired, or revoked |

The amber state is not a degraded failure to be hidden. It is the honest answer, and stating it plainly is what makes green mean something.

**Revocation.** Tokens carry a short rolling expiry re-issued on sync, and the app caches a revocation list. A device that has not synced beyond the configured window shows amber with the sync date.

**Replay and screenshots.** A static QR can be photographed and shown by a non-member. Mitigations in order of practicality:

1. **The photo is the primary control.** The verification page leads with the member's photo. Officer training is one sentence: *look at the photo, then look at the person.*
2. **Scan logging**, two-way: a member can see who verified his card and when. A verification system only officers can audit invites misuse.
3. **Rotating code** (TOTP-style, 30-second refresh) defeats screenshots entirely but breaks offline and printed use. A later mode, not the default.

**Attendance scanning.** A scan checks the brother into the open meeting with a timestamp. A second scan does not double-count — it surfaces *already checked in at 6:58 PM*. A card from another chapter is flagged as a visitor. **The contribution amount is never inferred from a scan** — the officer types it or leaves it blank. Manual check-in remains available in full; the scanner speeds the queue, it never becomes the only way in.

**Implementation notes.** `getUserMedia` for the camera; native `BarcodeDetector` where available, with a **WebAssembly fallback (`zxing-wasm` or `jsQR`) for iOS Safari, which does not implement it.** Budget for the fallback — it is not optional if iPhone support is promised. `getUserMedia` requires HTTPS, which makes the TLS certificate a Phase 1 dependency rather than a launch-week task. Manual entry of the printed member number performs the same lookup. Rate-limit verification lookups per device; an unthrottled endpoint is an enumeration oracle.

### 4.11 Chapter settings

Per client decision, chapters configure their own, within national defaults: suggested contribution amount, corrective-action visibility, cross-chapter visibility, chat retention. Council access to chapter finances is a national switch, currently off.

---

## 5. Central Portal — Annual Renewal

### 5.1 The model

Renewal works the way **annual vehicle registration** works. A chapter, like a vehicle, is already registered and already has its records. Once a year it is re-validated, a fee is paid per member, an authority approves it, and the result is a visible mark of currency.

```
Chapter (roster from AIS) → submits → City/Municipal Council → verifies → approves + issues receipt
                                              ↓ if it does not act
                                       Province → Region → National (override)
                                              ↓ on approval
                     Member notified in AIS · card year-sealed · commemorative card issued
```

### 5.2 Season configuration (National Secretariat)

Set once per year before the season opens. No council or chapter can alter any of it.

| Setting | Value | Note |
|---|---|---|
| Membership year | **09 August → 08 August** | Anchored on the 8 August anniversary |
| Season opens | 01 May | |
| Season closes | **08 August** | Anniversary day. The card lapses at midnight |
| Grace period ends | 08 October | |
| Fee per member | ₱50.00 | |
| Late fee during grace | ₱25.00 per member | For National Council decision |
| City council window | 10 working days | Arms provincial override |
| Province may act after | day 10 | |
| Region may act after | day 20 | |
| National may act | any time | |

**Naming the year.** The membership year spans two calendar years and is named by the year it **opens** — the *2027 card* covers 09 Aug 2027 to 08 Aug 2028 — and both dates are printed on the card. Fix this convention now; once seals are issued it cannot be changed without reissuing every card ever granted.

**On the grace period.** Not leniency — it is the difference between a brother lapsing and a brother leaving. Systems that skip it lose people over ₱50 and a fortnight, and winning them back costs far more than the fee.

**On the 10-day window.** A proposal, not a fact, and the single most consequential setting in the module. Too short and every application escalates, making override routine and therefore meaningless. Too long and the chapter carries the cost of a council that will not convene. It must be changeable from the configuration screen without a code release.

**Working days, not calendar days** — the clock must respect weekends and Philippine public holidays.

### 5.3 Chapter submission

1. The Chapter President opens *Annual Renewal — YYYY*.
2. The Portal pulls the chapter's live masterlist from AIS. **Read-only. Nothing is re-keyed.**
3. He ticks each brother renewing.
4. Fee = members ticked × fee per member.
5. Proof of payment is attached and the application submitted.

**One submission, two outcomes.** Chapter renewal and member renewal are a single application. The member count *is* the basis of the chapter's renewal; splitting them would mean submitting the same roster twice.

**A member not ticked is not expelled.** Three statuses:

| Status | Meaning |
|---|---|
| **Renewed** | Ticked, paid, approved for the year |
| **Lapsed** | Not renewed this year. Reversible in any later year. Not a disciplinary state |
| **Exempt** | Honorary, or excused by the chapter for a stated reason. Counts as current; no fee |

Exempt exists because without it, chapters will tick brothers they have not collected from in order to protect them — corrupting both the roster and the money in one step.

**The remittance posts to the chapter's AIS ledger** as a single Cash Out entry, and the council's receipt mirrors back as an acknowledgement. Members see the money leave and see it received; the two sets of books reconcile by construction rather than by meeting.

### 5.4 Council review

The council approves the **list**, verifying it line by line. If a name should not be there the application is **returned with a remark** — never approved and corrected later.

**Rejection is not an available action.** Approve or return. A chapter that has paid must always have a route forward; a dead-end rejection with money already collected is how disputes start.

**An application cannot be approved while its fee is unposted.** Approving nine members with no receipt behind them creates a discrepancy that surfaces a year later when nobody remembers.

### 5.5 Escalation and override

**Escalation is automatic and visible.** Every application shows a public countdown — *day 3 of 10* — seen by the chapter, the reviewing council and every council above. In practice this is what moves applications. Override is the backstop, not the mechanism, and **"send reminder instead" is a first-class button beside it.**

Override rules:

- A higher council may act only after the window below has lapsed. National may act at any time as the ultimate authority.
- **A reason is mandatory**, from a list, with free-text remarks.
- The bypassed council is **notified immediately and named in the record**.
- The record reads permanently: *approved by [council] on override of [council], reason, date, notice sent*.
- **The clock pauses when an application is returned**, so a chapter's correction time is not counted against its council.

An override that leaves no trace stops being a remedy for delay and becomes a way of taking authority from a council somebody dislikes. Making it loud is what keeps it rare and legitimate.

### 5.6 On approval

Approval is the only event that confers anything. A paid but unapproved application confers nothing. Atomically:

1. Each member's AIS record gains `RenewedThrough = 08 Aug YYYY+1`.
2. Each member is notified inside AIS.
3. His digital ID regenerates with the year seal.
4. His public verification page reads *current through 08 Aug YYYY+1*.
5. His commemorative year card is issued.
6. The chapter's renewal rate updates on every council dashboard.
7. The acknowledgement receipt is generated.
8. Everything above is written to the audit log.

### 5.7 Fees and the acknowledgement receipt

**Recording before processing.** Phase 1 records money that has already changed hands: OR number, date, amount, who received it, receipt scan. Online payment (GCash, Maya, bank) is Phase 2. Councils already collect cash; the hard part of payments is never collection, it is **reconciliation**. Build that first on money already controlled.

**The split** — proposed; the percentages are a National Council decision:

| Level | Share | Per member | Purpose stated to members |
|---|---|---|---|
| National Council | 40% | ₱20.00 | National programs, portal and AIS hosting, ID issuance |
| Regional Council | 30% | ₱15.00 | Regional activities and council operations |
| Provincial Council | 20% | ₱10.00 | Provincial activities and oversight |
| City / Municipal Council | 10% | ₱5.00 | Local council operations and chapter support |

**Make the split visible at every level, to everyone,** and **publish the purpose column, not just the percentage.** A brother paying ₱50 accepts it readily if he can see what each peso funds; he resents it permanently if all he sees is a deduction. A share nobody can see is a share somebody will eventually argue about.

**The acknowledgement receipt**

- **One receipt per application, not per member.** Eight members produce one AR for ₱400, referencing the roster by application number. Eight receipts of ₱50 would triple the paperwork and make reconciliation harder.
- Contains: AR number, date, received from (chapter and president), amount in figures **and in words**, particulars (N members × ₱50, membership year, application reference), mode of payment and OR number, receiving officer, council dry seal area, and the fee split.
- **System-generated with a verification code**, valid without a manual signature — otherwise the first council to print one will ask where the officer signs.
- **Numbers are never reused.** A mistake is **voided** with a reason and a countersignature; the number is retired and a fresh receipt issued. **There is no delete, for any role, including the system administrator.**
- On issue: emailed to the chapter president, posted to the chapter's AIS ledger as an acknowledged remittance.

---

## 6. Recognition — the badge system

The purpose is appreciation for active participation. **It is never a rank**, and several design constraints follow from that.

### 6.1 The consequence — a year-validated digital ID *(build first)*

The existing card gains a brass year seal and a validity line: *VALID THROUGH 08 AUG 2028*. Unrenewed, it greys out and the public verification page reads *lapsed 08 Aug 2027*.

This is the item that matters most, because it attaches renewal to something that already carries weight — his standing as a brother, verifiable by anyone with a phone camera. Without it, renewal produces a receipt.

### 6.2 The reward — an annual commemorative card *(build first)*

One card per membership year, earned only by renewing in that year, collected in his profile. Tapping a year seal opens that year's card.

**Three properties make it collectible, and it needs all three:**

| Property | How it is achieved |
|---|---|
| **Variation** | Each year has its own finish, emblem and theme. 2027 is not a recoloured 2026 |
| **Provenance** | The back carries facts unique to that year: the National President who served, the anniversary number, the nationwide count of brothers who renewed, and his own chapter |
| **Scarcity** | Earnable only in its year. A missed year leaves a gap that can never be filled — no back-issue, no purchase, no gift |

**Design a template, not fifty cards.** A new design is needed every August, forever, and hand-designing each will fail by year four. Define one layout with parameters — finish, pattern motif, year emblem, theme word — and vary those. The mockup demonstrates five finishes from a single template. Reserve the most distinctive for anniversary years.

**The card is a keepsake, not proof of standing.** It carries **no QR and cannot be verified.** This separation must not be relaxed: if a commemorative card were verifiable, a beautiful 2023 card would eventually be shown as proof of current membership. The digital ID remains the only card that proves currency.

**Never transferable.** Not sold, not gifted, not tradeable. The only way to hold a 2027 card is to have been an active brother in 2027.

**One-tap share.** Export as an image. Brothers posting their cards on 8 August is how the next man learns these exist, and it costs nothing to build.

### 6.3 Tenure milestones *(second season)*

A rarer object at **10, 15, 20 and 25 continuous years** — and **not another card**. A plaque or trophy, rendered as a distinct object in the app. Yearly awards are small and many; milestone awards are large and rare, and the visual difference should say so before a word is read.

This is what gives a brother in year four a reason to care about year five. Resist adding 1-, 2- and 3-year marks. A physical plaque awarded at a chapter event pairs naturally; the Portal can produce the award list per chapter each August.

### 6.4 A chapter badge *(second season)*

**"100% renewed, YYYY"** for a chapter where every active brother renewed, shown on the chapter profile and ranked on council dashboards. This is the strongest behavioural lever in the design: it makes the chapter president the person chasing the last three members, which no council has managed effectively from above.

### 6.5 Four cautions

1. **Do not let a badge look like rank.** Keep the visual language about membership years. A brother with 25 seals must never appear to outrank a seated chapter president.
2. **Do not publish the gaps.** Current status and continuous-years count may be public. A year-by-year map of when a brother could not afford ₱50 must not be — that is hardship made permanent and visible to everyone he knows. The gap map is visible to him and his officers only.
3. **Keep every year's card the same size and weight.** No tiers, no "rare / legendary" language, no leaderboard of who holds the most. Variation belongs in *character*, not in *value*. The moment a collection can be ranked, it reads as rank.
4. **Do not ship rewards before the consequence works.** If a lapsed member's card still verifies as current, no seal will make anyone renew. §6.1 and §6.2 belong in the same release, or neither does its job.

---

## 7. Technical Architecture

### 7.1 Stack

| Layer | Technology | Rationale |
|---|---|---|
| Database | **SQL Server** | Client's existing platform. **A new database is being built** — the legacy schema is not being migrated |
| Backend | **ASP.NET Core 8 Web API (C#)** | Team's primary language; strong async and SignalR support |
| Data access | Dapper over stored procedures | Matches existing T-SQL practice; predictable performance |
| Real-time | **SignalR** | Chat, live announcement push |
| Frontend | React + TypeScript, or Blazor WASM if the team prefers to stay in C# | |
| Mobile delivery | **PWA** — installable on Android and iPhone | One codebase, no app store review cycle |
| Push | Web Push (VAPID) + FCM | See caveat |
| File storage | Blob storage on the server's file system, served through the API — **not** in the database | Photos and receipts grow fast |
| Auth | ASP.NET Core Identity + JWT (access + refresh) | 2FA required for officer accounts |
| QR decode | `BarcodeDetector` with `zxing-wasm` fallback | iOS Safari lacks the native API |
| Reports | QuestPDF or similar | |

**Hosting is on-premise** — a Windows Server the client owns, IIS in front of Kestrel. Two prerequisites need planning before Phase 0:

1. **A public domain with a valid TLS certificate** (Let's Encrypt with auto-renewal, or purchased). This is not optional: `getUserMedia` — and therefore all QR scanning — requires HTTPS, and PWA installation does too.
2. **Off-site backup.** A transparency system whose ledger lives on one server in one building is one flood away from losing everything. Nightly full plus transaction log backups, replicated off-site, with a **tested restore before go-live**.

Also to confirm: static or dynamic IP at the server, and the upstream bandwidth available for photo and receipt uploads at national scale.

**iOS caveat.** iOS supports PWA installation and, since 16.4, web push for home-screen-installed apps — but push is less reliable than native and Apple has changed PWA behaviour before. Ship the PWA first; evaluate a thin native wrapper (.NET MAUI or Capacitor) in a later phase if iPhone push proves inadequate in practice. **Do not promise App Store presence in Phase 1.**

### 7.2 Data model

```sql
-- Organization
Council            (CouncilId, ParentCouncilId, CouncilLevelId, CouncilName, CountryCode, IsActive)
CouncilLevel       (CouncilLevelId, LevelName, LevelOrder)
Chapter            (ChapterId, ParentCouncilId, ChapterName, Barangay, DateChartered, IsActive)

-- Members
Member             (MemberId, ChapterId, MemberNumber, FirstName, MiddleName, LastName,
                    GiftName, Birthdate, Address, BloodTypeId, Profession, PhotoPath,
                    DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
                    MobileNo, Email, StatusId, RenewedThrough, ApprovedBy, ApprovedDate)
MemberStatus       (StatusId, StatusName)         -- Pending, Approved, Active, Inactive, Suspended
MemberSkill        (MemberId, SkillId)
Skill              (SkillId, SkillName, IsActive)
MemberRole         (MemberRoleId, MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)

-- Chapter operations
Meeting            (MeetingId, ChapterId, Subject, MeetingDate, Body, Location,
                    IsFinalized, FinalizedBy, FinalizedDate, CreatedBy, CreatedDate)
MeetingAttendance  (MeetingAttendanceId, MeetingId, MemberId, AttendanceStatusId,
                    FundAmount, CheckedInAt, CheckedInVia, Remarks)
Activity           (ActivityId, ChapterId, ActivityName, ActivityDate, Description, StatusId)

-- Money (chapter)
LedgerEntry        (LedgerEntryId, ChapterId, EntryDate, EntryType, Amount, Description,
                    SourceType, SourceId, ActivityId, IsReversal, ReversesEntryId,
                    CreatedBy, CreatedDate)                       -- APPEND ONLY
Expense            (ExpenseId, ChapterId, ActivityId, ExpenseDate, Payee, Description,
                    Amount, CategoryId, RecordedBy, ApprovedBy)
ExpenseAttachment  (AttachmentId, ExpenseId, FilePath, FileName, FileSize, UploadedBy)
Donation           (DonationId, ChapterId, ActivityId, DonationDate, DonorName, DonorTypeId,
                    Subject, Body, Amount, InKindDescription, AckReceiptNo, RecordedBy)

-- Communications
Announcement       (AnnouncementId, ScopeType, ScopeId, Title, Body, PublishDate,
                    ExpiryDate, IsUrgent, UrgentTypeId, CreatedBy, CreatedDate)
Memo               (MemoId, MemoNumber, ScopeType, ScopeId, Title, Body, PublishDate, CreatedBy)
ReadReceipt        (ReadReceiptId, DocumentType, DocumentId, MemberId, ReadDate)

-- Discipline
CorrectiveAction   (CaseId, ChapterId, MemberId, CategoryId, DateFiled, FiledBy,
                    Content, StatusId, ResolutionNotes, ResolutionDate)   -- NO DELETE
CorrectiveActionUpdate (UpdateId, CaseId, UpdateDate, UpdatedBy, StatusId, Notes)

-- Chat
ChatRoom           (RoomId, RoomType, ChapterId, RoomName)
ChatParticipant    (RoomId, MemberId, JoinedDate, LastReadMessageId, IsMuted)
ChatMessage        (MessageId, RoomId, SenderId, Body, AttachmentPath, SentDate,
                    IsDeleted, DeletedBy, FlagCount)

-- Identity and verification
MemberCredential   (CredentialId, MemberId, TokenSubject, IssuedDate, ExpiryDate,
                    RevokedDate, RevokedBy, PublicKeyVersion)
ScanLog            (ScanId, CredentialId, ScannedByMemberId, ScanDate, ResultCode,
                    WasOffline, MeetingId, DeviceHint)

-- Portal: renewal
RenewalPeriod      (PeriodId, Year, OpensDate, ClosesDate, GraceEndsDate,
                    FeePerMember, LateFeePerMember, CityWindowDays,
                    ProvinceArmsDay, RegionArmsDay, IsOpen, ConfiguredBy)
FeeSplit           (FeeSplitId, PeriodId, CouncilLevelId, SharePercent, PurposeText)
ChapterRenewal     (RenewalId, ReferenceNo, ChapterId, PeriodId, SubmittedBy, SubmittedDate,
                    MemberCount, TotalFee, StatusId, ApprovedByCouncilId, ApprovedByMemberId,
                    ApprovedDate, IsOverride, OverriddenCouncilId, OverrideReasonId, OverrideRemarks)
MemberRenewal      (MemberRenewalId, RenewalId, MemberId, RenewalStatusId,
                    FeeAmount, RenewedThrough)     -- Renewed | Lapsed | Exempt
RenewalAction      (ActionId, RenewalId, CouncilId, ActorMemberId, ActionTypeId,
                    ActionDate, Remarks)           -- APPEND ONLY: submit, return, remind,
                                                    -- approve, override
RenewalPayment     (PaymentId, RenewalId, ORNumber, PaidDate, Amount, ReceivedBy,
                    ScanPath, PostedBy, PostedDate)
AckReceipt         (AckReceiptId, ARNumber, RenewalId, IssuedByCouncilId, IssuedByMemberId,
                    IssuedDate, Amount, AmountInWords, VerificationCode,
                    IsVoided, VoidReason, VoidedBy, VoidedDate)   -- NUMBER NEVER REUSED
Remittance         (RemittanceId, PeriodId, FromCouncilId, ToCouncilId, Amount,
                    RemittedDate, ORNumber, ScanPath)

-- Recognition
MemberSeal         (SealId, MemberId, Year, SealTypeId, IssuedDate, RenewalId)
ChapterSeal        (ChapterSealId, ChapterId, Year, SealTypeId, IssuedDate)

-- Audit
AuditLog           (AuditId, TableName, RecordId, Action, OldValues, NewValues,
                    PerformedBy, PerformedDate, IpAddress)
```

### 7.3 Cross-cutting requirements

- **Audit log on every write.** Non-negotiable for a transparency system. Implement as a shared interceptor or triggers, never per-module code.
- **Soft delete** everywhere except the ledger, corrective actions and receipts, which are strictly append-only.
- **Row-level scoping.** Every query filtered by the caller's permitted scope, enforced in one place. This is the highest-risk defect class in a multi-tenant system — one missed `WHERE ChapterId = @x` leaks another chapter's financials.
- **Idempotent submission.** A double-tap must not create two renewal applications. Unique key on `(ChapterId, PeriodId)` for non-returned applications.
- **Concurrency:** `RowVersion` on editable records.
- **Indexes:** `Member(ChapterId, StatusId)`, `Member(BloodTypeId)`, `MemberSkill(SkillId)`, `LedgerEntry(ChapterId, EntryDate)`, `MeetingAttendance(MeetingId)`, `ChatMessage(RoomId, SentDate DESC)`, `ChapterRenewal(PeriodId, StatusId)`.
- **Headless smoke tests.** Every route loaded in a real browser context, asserting no console errors. A single top-level name collision or a bad template literal takes down an entire page, and neither is visible to linting or to server-side syntax checks. This was learned the hard way during mockup development and belongs in CI.
- **Environments:** Dev → Staging (client UAT) → Production. No direct production database edits.
- **The Portal never edits member data.** Corrections happen in AIS, by the chapter. One source of truth.

---

## 7A. Deployment Topology and Chapter Identity

### 7A.1 One deployment, one URL, one database

Adding a chapter is an `INSERT` into `dbo.Chapter`, **not a new site or a new application pool.**
Per-chapter deployment is not merely more work — it makes several specified features impossible:

| Feature | Why per-chapter deployment breaks it |
|---|---|
| Central Portal renewal | Reads a chapter's roster and writes back a result. Across 1,100 databases a city council would have to federate eight of them to approve eight chapters |
| Cross-chapter blood search | Databases that do not know about each other cannot be searched |
| One national digital ID | One issuing authority and one verification URL become 1,100 of each |
| Member transfer between chapters | Becomes a data migration instead of updating one column |
| Security patching | One fix × 1,100 IIS sites, and 1,100 restore drills |

**Scale is not the constraint.** ~1,100 chapters × ~20 members ≈ 22,000 member rows — nothing for
SQL Server on a single on-premise box. The growth is in **photos and receipts**, which live on disk
under a per-chapter path and are served through the API. Budget disk and upstream bandwidth for
those, not for table size.

**Suggested hosts**

```
ais.akrho.ph      members and chapter officers (the PWA)
portal.akrho.ph   councils
api.akrho.ph      one API serving both
verify.akrho.ph   the public QR verification page
```

**Do not use a subdomain per chapter.** It needs a wildcard certificate, buys nothing, and the
chapter still has to be resolved from the token. **The chapter comes from the JWT, never from the
URL** — a chapter in a hostname is a filter the user can edit.

**The trade-off, stated plainly.** Single-tenant means one missed `WHERE ChapterId = @x` leaks every
chapter's financial records at once. That is why scoping is enforced in two places (`IScopeGuard`
in C# and `@RequestingMemberId` in every procedure) and why scope-leak tests are written first.
Neither layer is removed because the other exists.

Separate deployment is justified in exactly two cases: a different country with data-residency law
(out of scope), and the staging environment.

### 7A.2 Registration order — the hierarchy must be built downward

Each body is the approving authority for the one beneath it, so **a body cannot be registered until
the body above it exists.**

```
National Council      seeded once at installation by the System Admin
  └ Regional Council      registered by National
      └ Provincial Council    registered by Regional
          └ City / Municipal Council   registered by Provincial
              └ Chapter                    registered by City / Municipal
                  └ Member                      approved by the Chapter Admin
```

Two consequences worth planning for:

1. **The National Council has no approver.** It is seeded by the System Admin at installation and
   is the one body created outside the workflow. Name this in the runbook rather than discovering it
   during the pilot.
2. **Council entry precedes any rollout.** Before a city can pilot, its province and region rows must
   exist. Entering the national skeleton — 17 regions, 81 provinces, ~1,600 cities and
   municipalities — is **data entry, not development**, and should run in parallel with Phases 0–2
   rather than blocking them.

**A member is approved by his chapter, not by a council.** Councils approve chapters, councils and
renewals. This distinction is easy to blur and is surfaced explicitly during registration: the
sign-up screen names the exact body that will receive the application.

### 7A.3 Chapter identity within a shared application

The login page is identical for every chapter — before sign-in the system does not know who the
person is. **From the moment he signs in, the app carries his chapter's mark.** The purpose is
ownership: a brother should feel he is using his chapter's app, not head office's.

| Surface | Chapter mark | Reason |
|---|---|---|
| App header, home, chapter screens | **Primary** | This is where ownership is felt |
| Chapter reports and exports | **Primary** | Shared outside the app, under the chapter's name |
| Digital ID | **Secondary** — small, on the back beside the member number | See below |
| Public verification page | **None** — national seal only | See below |
| Login page | **None** until first sign-in; afterwards the device may show the remembered chapter | Identity is unknown before authentication |

**The ID stays national on purpose.** A card leading with a chapter logo stops looking like one
national credential and starts looking like 1,100 different ones — which is exactly what a hospital
or a checkpoint cannot verify at a glance. This is the same argument that justifies national
adoption in the first place; do not undercut it in the interface.

**Implementation constraints**

- Square image, transparent background, ≥512px, ≤200 KB, stored per chapter on disk.
- **A generated monogram is the default**, so a chapter that has no logo file still looks finished
  on day one. Most will not have one at go-live.
- **Accent colour is chosen from a fixed approved palette (six options)**, not a colour picker.
  Free colour choice breaks text contrast and accessibility, and makes the app impossible to support
  over the phone when every chapter looks different. Everything outside the mark and the accent
  stays national.
- **A new logo is reviewed by the city council before it goes live.** This is not bureaucracy; it is
  the only control between the organization and a chapter uploading something it should not.
- Logo changes are audited like any other write.

### 7A.4 Chapter registration and officer credentials

The organization already has this process on paper: a chapter fills up a registration form listing
its officers and submits it to its designated council; the council verifies and grants access. The
system reproduces it rather than replacing it.

**The form is public, and it has to be.** A chapter applying to be registered has no account and
cannot be given one first. The form is reachable from the Portal sign-in page and requires no login.
On submission the applicant receives a **reference number** (`CHR-YYYY-NNNN`); that number plus the
president's mobile is enough to check progress without an account.

**The officer roster is the substance of the form.** Eight offices, matching the existing paper form:

| Office | System access on approval |
|---|---|
| President | Full chapter admin. Receives the chapter's first account |
| Vice President | Officer |
| Secretary | Officer — meetings, attendance, announcements, memos |
| Treasurer | Officer — ledger, expenses, donations, receipts |
| Auditor | **Read-only.** Reads everything, changes nothing |
| Master Initiator I, II, III | **Recorded office. No login.** |

Two decisions here are worth confirming rather than assuming:

- **The Auditor is read-only, not an officer.** An auditor who can edit what he audits is not an
  auditor. He sees every record, including the ledger and case narratives, and can change none of it.
- **The three Master Initiators are recorded, not given accounts.** The office is organizational
  rather than administrative; recording it preserves the chapter's history without handing three more
  people the ability to edit records. If a chapter wants one of them to also hold a system role, he
  is named in that role as well.

**A mobile number is mandatory for every officer.** It is how the enrolment link reaches him and how
his account is recovered. An officer with no number cannot be given access.

**Terms are dated** (`TermStart`, `TermEnd`) so permissions lapse automatically. This matters more
than it appears: without it a chapter enters each new year with last year's secretary still able to
edit meetings and last year's treasurer still able to post to the ledger.

#### How credentials are issued

**No password is ever transmitted.** Not by SMS, not by email, not by the council by hand. A password
you transmit is a password you no longer control, and it will be reused on the treasurer's account
within a month.

On approval, in one transaction:

1. The chapter is created and given its chapter number.
2. The officers become member records with their offices and term dates.
3. The chapter's mark is generated from its name until a logo is uploaded.
4. Its ledger opens at zero and its first renewal season is scheduled.
5. **The President is sent a one-time enrolment link, valid 72 hours**, tied to the mobile number on
   the form. He sets his own password and enables two-factor before the account works.
6. The chapter appears in the AIS sign-up list so its brothers can register.

The President then invites the other officers the same way from inside the app. The Master
Initiators are sent nothing — they have no permission to receive.

**Verification is per officer, not per form.** The council ticks each officer off against the
sponsoring chapter's records. An unverified officer means the form is **returned with a remark**, not
approved-and-corrected-later: approving a roster the council cannot vouch for is how a chapter ends
up with an officer nobody recognises three years on. As elsewhere, rejection is not an available
action — a chapter that has organized and petitioned must always have a route forward.

#### The same form, every year

Officer turnover uses the identical form. **This is not a separate process**; it is the chapter
registration form filed again after the chapter exists, each August when officers change. Build it
once and reuse it.

On approval of an officer update:

- Outgoing officers keep their member records and their history. Only the office ends.
- Their term is closed and permissions drop that night.
- Incoming officers receive enrolment links, not passwords.
- **An account is never handed over.** The outgoing secretary's login is not passed to the incoming
  one. Shared or inherited accounts destroy the audit trail, and the audit trail is the only reason
  a member believes the balance on his phone.

### 7A.5 Council registration

A council is **an organ of the level above it**, not a voluntary association like a chapter. That
difference drives everything below.

**Who approves what**

| Body | Registered by | Approved by |
|---|---|---|
| National Council | System Admin at installation | — *(the one body outside the workflow)* |
| Regional Council | National Council | National Council |
| Provincial Council | Regional Council | Regional Council |
| City / Municipal Council | Provincial Council | Provincial Council |
| Chapter | City / Municipal Council | City / Municipal Council |
| Member | Registers himself | His Chapter Admin |

**Three origins, one approving body**

| Origin | When it applies | Filed from |
|---|---|---|
| **Constituted from above** *(the normal route)* | A jurisdiction exists and the parent council seats officers | Inside the Portal, by the parent |
| **Petitioned from below** | Chapters in an unserved city want their own council | A public form — the petitioning chapters have AIS accounts but no council account to file from |
| **Reconstituted** | A dormant council is being revived | Inside the Portal, by the parent |

The approving body is the parent council in all three cases. Only the initiator differs.

**A council is created empty.** Unlike a chapter, it needs no members of its own to exist — chapters
attach to it afterwards. Getting this backwards would make it impossible to register the first
council in a new province.

**Council offices**

| Office | Access |
|---|---|
| President | Full council admin. Approves the bodies one level below |
| Vice President | Officer |
| Secretary | Officer — receives and processes applications from below |
| Treasurer | Officer — posts fees received, remits upward |
| Auditor | **Read-only** |
| Public Information Officer | Officer — memos and announcements down the chain |

**There are no Master Initiators on a council.** That office belongs to a chapter's rite, not a
council's function. Copying the chapter roster wholesale would create three council seats with
nothing to do.

**Council officers are selected from existing members, never typed in.** Every seat resolves to a
real member number in a real chapter, so the officer's record, history and own renewal follow him
into office. This is the key difference from a chapter charter, where nobody exists in the system
yet and the officers are entered as new people.

*The one exception:* a brand-new region with no chapters beneath it yet. Those first seats are filled
by member number from elsewhere in the country.

**Every seat is validated against the officer's own renewal.** A council officer who has lapsed
cannot approve other people's renewals — the office would be auditing a rule he is currently
breaking. The system checks each seat's `RenewedThrough` date at the moment of approval, because a
human reviewer never will.

**A council pays no fee.** It is not renewed and pays nothing to exist. Only members renew, and only
chapters remit.

**A council inherits, it does not configure.** The fee, the split, the renewal calendar and the
escalation clock are national settings. A council sets none of them.

#### Dormancy, reassignment, and never deleting

Councils need a status: **Active / Dormant / Dissolved**.

**A dormant council is not a cosmetic problem.** It is the approving body for everything beneath it,
so ten chapters under a council with no seated officers have nobody to approve their renewals. The
escalation clock (§5.5) covers the delay — the level above can act over the empty seat — but that is
a workaround, not a fix. The registry surfaces dormant councils with the count of bodies affected so
they are reconstituted rather than quietly tolerated.

**Reconstitution is not creation.** The council row, its history, its past approvals and its chapters
all remain; only the officers change.

**A council is never deleted.** Philippine local government is reorganised — barangays split, new
cities are created, municipalities merge. When that happens, **chapters are reassigned to another
council and the old row stays**, marked Dissolved. Every renewal, receipt and approval ever made
beneath it references that row forever, and a deleted council orphans all of it.

Chapter reassignment is an explicit, audited operation. A chapter is never left without a parent
council, because a chapter with no approving body cannot renew.

### 7A.6 Bootstrap and approval routing

Two rules make the hierarchy buildable from nothing without a single account belonging to someone
outside the register.

> **1. An application is approved by the nearest existing ancestor with seated officers.**
> **2. A council can only be created once at least one registered chapter exists in its jurisdiction.**

#### The deadlock these solve

Council officers are selected from a dropdown of existing members. Members are created by chapters
only. A chapter is approved by its city council. A city council needs officers. The ring closes at
every level below National.

Rule 1 breaks it, and it is not a new mechanism — it is the escalation ladder already specified for
renewals (§5.5), applied one level wider. **One rule covers four situations**, which is the reason to
prefer it over anything purpose-built:

| Situation | Who approves |
|---|---|
| Normal operation | The immediate parent |
| **Bootstrap or expansion** — the parent does not exist yet | The nearest ancestor that does |
| **Dormancy** — the parent exists but nobody is seated | The nearest ancestor with seated officers |
| **Delay** — the parent exists and will not act | The ancestor, on override, after the window |

Implemented in `usp_Approval_ResolveApprover`, which walks up the tree until it finds a council that
exists *and* has a current `MemberRole` scoped to it. Every routed approval writes a row to
`dbo.ApprovalRouting` recording the intended council, the acting council, and why they differed.

**Rule 2 reverses what an earlier version of this document said.** It previously stated that a
council is created empty and chapters attach afterwards. That is wrong: if officer fields are
dropdowns, the dropdown must have something in it, and the only source is chapters in that
jurisdiction. It also matches the organization — a city council with no chapters governs nothing.
Enforced by `usp_Council_Create`, which throws if no registered chapter with active members exists
beneath the parent.

#### Order of operations at go-live

Exactly two things are seeded.

| # | Step | Actor |
|---|---|---|
| 0 | Seed the **National Council body** and a **System Admin technical account**. No member is created, no officer seated | System Admin, once |
| 1 | **Pilot chapters register.** No city, provincial or regional council exists, so National approves them as nearest existing ancestor. *The register comes into existence here* | Chapters → National |
| 2 | **National seats its own officers**, selected from the members created in step 1. **The System Admin's organizational authority ends** | System Admin → dropdown |
| 3 | **National creates the first region**, officers from members of chapters inside it | National Council |
| 4 | **Region creates the province; province creates the city council.** Same screen, same dropdown | Each level |
| 5 | **Steady state.** New chapters route to their own city council | — |

**Choose pilot chapters concentrated in one city, one province, one region.** A pilot scattered
across four regions can seat no council except National.

**Bootstrap is not a one-time event.** The same sequence runs at the edge of the organization every
time it grows into a new city: chapters register and the province approves them; once there are
members, the province creates the city council. It is an ordinary path, not a migration script.

#### Council officers must be in jurisdiction

An officer of the Laguna Provincial Council must be a member of a chapter under Laguna. The dropdown
is populated by `usp_Council_EligibleOfficers`, which walks the council's own subtree.

**Seating someone from outside is permitted** — a province with one chapter cannot supply six
officers. There is **no waiver and no approval step**. The seat is recorded in `dbo.SeatOverride`
with the member, his home chapter, the officer who seated him, and the reason. Permanent and visible
in the registry.

This is the right trade: a waiver would create a second approval workflow for a situation that is
common and legitimate. A log creates accountability without creating bureaucracy.

#### Unserved jurisdictions

`usp_Council_UnservedJurisdictions` lists councils carrying **three or more chapters** in a
jurisdiction that has no seated council of its own.

**This is information, not a deadline.** A council may be created the moment there are members to
seat and never before; nothing expires and nothing is forced. But a province quietly carrying twenty
chapters that should have had their own city council is a workload and legitimacy problem invisible
until renewal season. Surface it; let the National Council act.

Note that two jurisdictions can look identical from below and be different problems: one has **no
council yet** (create one), the other has **a council nobody is running** (seat officers). The list
distinguishes them.

#### The System Admin handover

The installer's organizational authority ends **the moment the National Council seats a president** —
as a consequence of that seating, not an action he takes. One-way, recorded in
`dbo.AuthorityHandover`.

**He keeps:** backups, restores, schema deployment, reading the audit log, re-issuing an enrolment
link to a locked-out account.
**He loses, permanently:** approving chapters, councils, renewals, or anything else organizational.

**Break-glass** requires **two people — the System Admin and one seated Regional President** — and
grants a 72-hour elevated session that announces itself in-app to every council officer, writes its
own audit record, expires automatically, and cannot be renewed by the same pair consecutively
(`dbo.BreakGlassSession`).

**Even elevated, he cannot do what nobody can do:** edit the ledger, delete a corrective action, void
a receipt outside the void process, or enrol a member. **Elevation restores approval authority only
and never touches the invariants.** That bounds a compromised admin account to *approved things he
should not have* — visible and reversible — rather than *rewrote the books*, which is not.

**One honest limit.** The System Admin has database access, and no application-level control
constrains that. He can run SQL directly. The real control is that the audit log is append-only and
shipped off-site nightly, which makes tampering **detectable** even though it is not **preventable**.
Anyone claiming an application can constrain its own DBA is mistaken.

*Practical implication, and it is a staffing decision rather than a software one:* whoever holds the
SQL Server credentials should not also hold an organizational office. Worth naming to the National
Council explicitly.

#### Detached members — unrelated to bootstrap

A brother whose chapter goes **dormant or is dissolved** was created by that chapter and is already
in the register. `HomeCouncilId` is a **transition applied to an existing member**, never a creation
path; `usp_Member_AttachToCouncil` throws if the member does not exist, saying so plainly.

He keeps his member number, seals and history, renews through the council, and counts toward no
chapter's membership, fee or 100% badge. The way out is a transfer, never a new record — and the real
fix is usually reviving the chapter.

---

## 8. Privacy and Compliance

The system holds sensitive personal information under the **Data Privacy Act of 2012 (RA 10173)** — health information (blood type) and disciplinary records.

- **Consent at registration** — a plain-language notice covering what is collected, who sees it, how long it is kept, and how to seek correction.
- **Member-controlled visibility** — a brother chooses whether his blood type and number are visible beyond his own chapter.
- **Encryption** in transit (TLS) and at rest.
- **Access logging** on views of sensitive records, and two-way scan logging.
- **Retention policy in writing** — chat at 12 months; renewal history permanent, because it is the evidence behind every seal on a brother's profile.
- **Breach response plan** and a designated Data Protection Officer.
- **Minors** — confirm with the client whether any registrant may be under 18; additional consent requirements would apply.

Registration with the National Privacy Commission may be required. **This is the organization's obligation, not the developer's — but the system must be built to support it,** and it must produce the records a DPO would need. Do not oversell compliance; state the boundary plainly.

---

## 9. Delivery Phases

Each phase is independently demonstrable and deployable. Client sign-off closes a phase before the next begins.

| Phase | Scope | Est. |
|---|---|---|
| **0 — Foundation** | Environments, repo, CI/CD (including headless smoke tests), database schema, TLS and domain, auth + 2FA, role framework, org hierarchy CRUD, audit log, responsive shell + PWA install | 3–4 weeks |
| **1 — Membership & identity** | Registration, seconder confirmation, approval workflow, profile, photo upload, directory with blood type / skill / profession filters, digital ID, **QR scanner + offline verification + public verification page** | 4–5 weeks |
| **2 — Meetings** | Meeting CRUD, attendance with voluntary fund entry, **QR check-in**, finalize/lock, auto-post to ledger, history | 3 weeks |
| **3 — Communications** | Announcements, memos, attachments, scope targeting, push, read receipts, urgent blood request routing | 2–3 weeks |
| **4 — Financials** | Append-only ledger, expenses with receipt capture, donations, Activity/Project entity, drill-downs | 3–4 weeks |
| **5 — Corrective actions** | Case CRUD, status workflow, update timeline, Option B visibility | 1–2 weeks |
| **6 — Dashboard & reports** | Chapter dashboard, drill-downs, date filters, Excel/PDF export | 2–3 weeks |
| **7 — Chat & landing** | Public chat, private messaging, moderation, retention purge, video panel, landing page | 3–4 weeks |
| **8 — Mobile hardening** | iOS/Android install testing, push reliability, offline directory cache, low-end device performance | 2 weeks |
| **9 — Portal foundation** | Portal shell, officer accounts, council scoping, season configuration, fee split | 2–3 weeks |
| **10 — Renewal** | Chapter submission from AIS roster, council verification, approval, escalation clock, override with recorded reason, acknowledgement receipt, remittance tracking, AIS write-back | 4–5 weeks |
| **11 — Recognition** | Year-validated ID, commemorative card template and first year's design, seal row, share export | 2–3 weeks |
| **12 — Pilot & launch** | Member data entry, pilot chapter, one full renewal season, training materials, phased rollout | 4+ weeks |

Deferred to later seasons: tenure milestone plaques, chapter badges, council roll-up dashboards, online payment rails, new chapter application, new council registration, officer registration.

---

## 10. Decisions on Record

Confirmed by the client. Any change to these has downstream consequences and should be a conscious reversal, not a drift.

| # | Decision |
|---|---|
| 1 | Corrective actions — Option B. Name, category, status and date public; narrative restricted to officers and the member concerned |
| 2 | Cross-chapter visibility — name, chapter and status only |
| 3 | Meeting contributions are **voluntary**; no arrears is ever computed or displayed |
| 4 | A **new database** is being built; the legacy schema is not migrated |
| 5 | A **new member number format** is created; no existing convention is preserved |
| 6 | Chapter settings are **flexible per chapter**, within national defaults |
| 7 | Council access to chapter finances is **off**; AIS is chapter-exclusive for now |
| 8 | Hosting is **on-premise**, on the client's own Windows Server |
| 9 | Scope is the **Philippines only** |
| 10 | Inactive status is set **manually** |
| 11 | Chat retention is **12 months** |
| 12 | Membership year runs **09 August → 08 August**, anchored on the anniversary |
| 13 | Renewal fee is **₱50 per member**, submitted by the chapter, approved by the city/municipal council |
| 14 | Higher councils may **override** a delayed approval; every override is recorded and the bypassed council named |
| 15 | The badge is a **token of appreciation, never a rank** |
| 16 | **One deployment, one URL, one database.** A chapter is a row, never a site |
| 17 | Chapters carry their own **mark and accent colour** inside the app; the login page and the digital ID stay national |
| 18 | **Passwords are never transmitted.** Access is granted by a one-time enrolment link; the officer sets his own password |
| 19 | **Accounts are never shared or handed over.** Officer turnover issues a new account and closes the old term |
| 20 | **Members are created by chapters only.** No council may enrol anybody, and no procedure that lets one may ever be added |
| 20a | **Approvals route to the nearest existing ancestor with seated officers.** Bootstrap, dormancy and delay are all cases of this one rule |
| 20b | **A council requires ≥1 registered chapter in its jurisdiction** before it can be created. Officers are selected from that jurisdiction; seating from outside is permitted but permanently logged in `SeatOverride` |
| 21 | A member's home of record is **a chapter or a council, never both and never neither**. Council attachment is a transition applied to an existing member, never a creation path |
| 22 | **Councils and chapters are never deleted.** A reorganised jurisdiction has its chapters reassigned; the old row stays, marked Dissolved |

---

## 11. Open Questions

**Renewal and fees**
1. Are the 40/30/20/10 split percentages correct, or does an existing rule apply?
2. Is there a late fee during the grace period, and how much?
3. Is 10 working days right for a city council that meets monthly? Should there be an "acknowledged" step that stops the clock?
4. Who may grant **Exempt** status — the chapter, or the council?
5. After how many consecutive lapsed years, if any, does a brother's AIS status change? Or never?
6. Do councils want online payment in season two, or is receipt-recording sufficient indefinitely?
7. Does a member receive anything showing he paid his own ₱50, or is the council's AR to the chapter the only document in the chain? *Recommendation: AIS should show each brother a line item against his own name on approval — otherwise the chapter's transparency stops exactly where the money leaves the chapter.*
8. Does a lapsed member lose access to AIS? *Recommendation: no — he keeps read access to his chapter. A brother locked out is a brother lost.*

**Recognition**
9. Is "the 2027 card" (opening year) the right name, or does the organization refer to it by the closing year?
10. Who chooses each year's theme and finish? *Recommendation: the National Council, announced when the season opens, so the design becomes part of the anniversary.*
11. Are 10/15/20/25 the right milestone intervals, and do they align with recognition the organization already confers?
12. Is 100% the right bar for the chapter badge, or does 90% earn a mark too?

**Councils**
13. When a brother's chapter is dormant and another chapter welcomes him — should he be **transferred** into the host chapter, or **attached** to the council? The system supports both and the distinction affects the host's member count, fee and 100% badge. *Recommendation: transfer if the host has genuinely taken him in; attach only when nobody has.*
14. How long may a member remain council-attached before review is compulsory? *Proposed: 24 months.*
15. Does a council's officer roster match the six offices proposed (President, VP, Secretary, Treasurer, Auditor, PIO), or does the organization seat others?
16. Can a brother hold a council office and a chapter office at the same time? The model allows it; the by-laws may not.
17. When a city is reorganised, who authorises reassigning its chapters — the province, or the National Council?

**Operations**
16. Static or dynamic IP at the server? What upstream bandwidth is available?
17. Will historical ledger and meeting records be keyed in, or does the system start clean at go-live?
18. Could any registrant be under 18?

---

## 12. Assumptions and Constraints

- No video files are hosted. Video is YouTube-embedded only.
- Chapters may have unreliable internet; the app must degrade gracefully on low-end Android devices, and ID verification must work offline.
- Amounts are in PHP. Multi-currency is out of scope.
- The system records organizational finances but is **not** an accounting system: no statutory financial statements, no tax filing.
- Content moderation is performed by chapter officers, not by the development team.
- Compliance obligations under RA 10173 rest with the organization; the system is built to support them.

---

## 13. Reference Artifacts

| Artifact | Purpose |
|---|---|
| `AIS-Mockup.html` | Clickable member/officer mockup — 36 screens, role switcher (Member / Officer / Chapter Admin / signed out) |
| `AIS-Portal-Mockup.html` | Clickable council portal mockup — sign-in, chapter submission, council verification, escalation, acknowledgement receipt |
| `AIS-National-Adoption.pptx` | 21-slide presentation for the National Council |

---

## 14. Document Control

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | Development Team | Initial draft from client overview |
| 1.1 | 2026-08-24 | Development Team | Client decisions incorporated; QR verification and scanning added |
| 2.0 | 2026-08-25 | **Development Team** | **Consolidated. Central Portal and renewal module folded in; membership year anchored to 8 August; recognition system specified; decisions on record listed; phases renumbered to 12. Supersedes the separate portal module specification.** |
| **2.1** | **2026-08-28** | **Development Team** | **§7A added: deployment topology, hierarchical registration order, chapter identity, chapter registration form, officer credential issuance, and council registration, bootstrap order, approval routing, jurisdiction rule for council officers, and the System Admin handover. Provisional seats removed.** |
