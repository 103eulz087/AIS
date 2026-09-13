---
description: Run the full definition of done and prepare a change for deployment
---

Prepare the current work for deployment.

1. Run the complete definition of done from `CLAUDE.md` §6 and report each check individually:
   - `dotnet build --warnaserror`
   - `dotnet test`
   - `cd src/web && npm run build && npm test && npm run smoke`
2. Run `/review`.
3. **`devops`** — confirm: any new environment variable documented? Any schema change safe to
   re-run via `scripts/db-deploy.sh`? Any new route needing an IIS rewrite rule?
4. Summarise the change in plain English — what a chapter secretary would notice is different.
5. List anything that still needs a human decision before this goes to production.

Do not report success on any check you did not actually run. If a check fails, stop and say so.
