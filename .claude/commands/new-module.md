---
description: Plan and build a new module end to end, delegating across the team in the correct order
argument-hint: <module name> [brief description]
---

Build the **$1** module for the AKRHO system.

Work in this order, delegating to the specialist agents. Do not skip ahead — each step depends on
the one before it.

1. **`tech-lead`** — read the relevant section of `docs/AIS-Project-Documentation.md` and produce a
   task plan. State which invariants from `CLAUDE.md` §2 are in play. Stop and confirm the plan
   with me before any code is written.
2. **`database`** — schema in `db/schema/`, procedures in `db/procs/`. Hand back the Dapper call
   signatures.
3. **`backend`** — the feature slice under `src/Akrho.Api/Features/`, with DTOs, validators and
   scoping through `IScopeGuard`.
4. **`frontend`** — screens in `src/web`, all four render states, route registered in both
   `routes.tsx` and `scripts/smoke.mjs`.
5. **`tester`** — tests, scope-leak cases first.
6. **`tech-lead`** — review against the invariants before it is considered done.

Then run the full definition of done from `CLAUDE.md` §6 and report which checks passed.

If anything in $1 appears to conflict with an invariant, stop and raise it. Do not design around it.
