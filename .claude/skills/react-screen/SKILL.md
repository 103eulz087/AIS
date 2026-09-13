---
name: react-screen
description: Build a screen in the React PWA — file placement, data fetching, the four render states, design tokens and formatting. Use for any new page or major component in src/web, in either AIS or the Portal.
---

# Building a screen

## Where it goes

```
src/web/src/ais/screens/<Name>.tsx        member + chapter officer (mobile-first)
src/web/src/portal/screens/<Name>.tsx     councils (desktop-first, phone-usable)
src/web/src/shared/                       tokens, primitives, api client, format
```

## The four states — write them in this order

Most bugs users actually hit are in states 1–3, so build them first.

```tsx
export function MemberDirectory() {
  const { data, error, isLoading } = useMembers({ chapterId, filters });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error)     return <ErrorState onRetry={refetch} />;
  if (!data?.items.length)
    return <EmptyState
             title="No brothers match that filter"
             body="Try clearing the blood type, or search other chapters." />;

  return <>{data.items.map(m => <MemberRow key={m.memberId} member={m} />)}</>;
}
```

**Write the empty state first.** It is what a brand-new chapter sees for its first week, and it is
the state most likely to be shipped broken.

## Formatting — never inline

```ts
import { peso, memberNo, shortDate } from "@/shared/format";
peso(38420)          // "₱38,420.00"   always 2 decimals, always monospace
memberNo("AKR040117001")
shortDate(iso)       // renders Asia/Manila from a UTC timestamp
```

## Tokens, not hex

```css
color: var(--ink);  background: var(--paper);  border-color: var(--line);
/* money */ .in { color: var(--in) } .out { color: var(--out) }
/* brass is the accent and carries meaning — use it sparingly */
```

Display type: Barlow Condensed. Body: IBM Plex Sans. **Figures and member numbers: IBM Plex Mono.**

## Rules

- **No `localStorage` for domain data.** Tokens in memory; offline cache via the service worker.
- **Never name a top-level binding `top`, `name`, `status`, `self`, `parent`, `length`** — they
  collide with non-configurable `window` properties and kill the entire bundle at load.
- Tap targets ≥ 44px. One-handed use on a cheap Android phone is the design case.
- Every list row that shows a figure links to the record behind it. A number the user cannot open
  is not transparency.

## Honesty rules that live in the UI

- ID verification renders three distinct states — **live (green), offline (amber), invalid (red)**.
  Never collapse amber into green.
- Never render an arrears or amount-owed figure.
- A brother's lapsed years appear to him and his officers; never on a public page.
- Corrective actions: the narrative field only renders when the API sent it. Do not fetch the full
  shape "just in case".

## Finish by

Adding the route to `src/web/src/routes.tsx` **and** to `src/web/src/smoke.test.tsx`. A route
not in the smoke list is a route nobody checks.
