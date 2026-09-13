---
name: smoke-test
description: Run and extend the jsdom route smoke harness that loads every screen and asserts no console errors. Use before every merge, after adding a route, and when a page reportedly "does not work" with no other detail.
---

# The smoke harness

`src/smoke.test.tsx`, run with `npm run smoke` from `src/web`.

## Why it exists

Two separate one-token mistakes took down entire pages during design of this system:

1. `onclick="go(\'x\')"` — an escaped quote inside a nested template literal.
2. `const top = () => …` — `top` is a non-configurable `window` property, so the declaration threw
   before a single line ran.

Neither was visible to ESLint, TypeScript, or a server-side syntax check. Both produced a blank
screen and a single console error. **A parse check is not a load check.** This harness is the only
thing in the pipeline that actually loads the code.

## What it asserts, per route

1. No `jsdomError` and no `console.error` during load or render.
2. The rendered container is not empty.
3. No `undefined`, `NaN` or `[object Object]` leaked into the DOM.
4. Every element with a click handler can be clicked without throwing.
5. Where a screen renders differently per role, mount it once per role — a screen can be fine
   for an officer and throw for a member, because the two receive different DTO shapes.

**What it cannot do.** Components are mounted in module scope, not browser global scope, so it
will NOT catch a top-level identifier colliding with a `window` property (`top`, `name`,
`status`, `self`, `parent`, `length`). Bundled modules are largely immune, but anything injected
as a classic script — an inline block in `index.html`, a third-party embed — is not. That rule
stays a review item; this harness cannot enforce it for you.

## Adding a route

```tsx
const ROUTES: Array<[path: string, element: React.ReactNode]> = [
  ["/members", <MemberDirectory />],
  ["/ledger",  <Ledger chapterId={1} />],
  // one line per route, added in the same commit as the screen
];
```

A route absent from this list is a route nobody checks. Add it in the same commit as the screen.

## Interpreting failures

| Symptom | Usual cause |
|---|---|
| `Identifier 'X' has already been declared` | Top-level name collides with a `window` property |
| `Invalid or unexpected token` | Escaped quote inside a nested template literal |
| Rendered empty | Component returned `null` for the loading or empty state |
| `undefined` in DOM | A DTO field absent for this role was rendered without a guard — often a **visibility rule working correctly** and the UI failing to respect it |
| Leaked `NaN` | Money parsed as `number` from a null, or a `decimal` field missing |

That fourth row matters: an `undefined` on a corrective-action screen usually means the API
correctly withheld the narrative and the component rendered it anyway. Fix the component, never
the API.

## In CI

Runs on every push after `npm run build`. **It is never skipped and never marked
`continue-on-error`.** A route that throws on load is a dead feature, and it will be found by a
member in a barangay before it is found by us.
