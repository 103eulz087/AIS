---
description: Review the current changes against the project invariants and definition of done
---

Review the working tree against `CLAUDE.md`.

Use the `tech-lead` agent. Check, specifically:

1. **Scoping** — is every new read and write filtered by the caller's scope through `IScopeGuard`
   and `@RequestingMemberId`? Is any `chapterId` taken from a request body and trusted?
2. **Append-only** — does anything update or delete `LedgerEntry`, `CorrectiveAction` or `AckReceipt`?
3. **Inline SQL** — any `SELECT`, `INSERT`, `UPDATE` string inside C#?
4. **Money** — any `float`, `double` or `MONEY` where `decimal` / `DECIMAL(18,2)` belongs?
5. **Arrears** — does any DTO, procedure or component carry an amount-owed or balance-due concept?
6. **Visibility** — do corrective-action and cross-chapter responses use the restricted DTO shape,
   with the sensitive field **absent** rather than empty?
7. **QR tokens** — does any credential payload contain a `MemberId` or a name?
8. **Front end** — any top-level binding named `top`, `name`, `status`, `self`, `parent`, `length`?
   Any `localStorage` holding domain data? Any new route missing from `src/smoke.test.tsx`?
9. **Definition of done** — run the §6 checklist and report each result.

Report findings as: **blocker** (breaks an invariant), **should fix** (will hurt later),
**note** (worth knowing). Be concrete about file and line. Say plainly if you find nothing wrong.
