/**
 * ROUTE SMOKE TEST — the highest-value test in this repo.
 *
 * WHY IT EXISTS: twice during design, a single-token mistake took down an entire page.
 * Neither was visible to ESLint, to TypeScript, or to a syntax check, because
 * A PARSE CHECK IS NOT A LOAD CHECK. This actually mounts every route.
 *
 * WHAT IT CANNOT DO: it renders components in a module scope, not a browser global
 * scope, so it will NOT catch a top-level identifier colliding with a `window`
 * property (`top`, `name`, `status`, `self`, `parent`, `length`). Bundled modules are
 * mostly immune to that, but any code injected as a classic script — an index.html
 * inline block, a third-party embed — is not. Keep that rule in review; this file
 * cannot enforce it for you.
 *
 * Every route in routes.tsx must appear here, added in the same commit as the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemberDirectory } from "@/ais/screens/MemberDirectory";
import { Ledger } from "@/ais/screens/Ledger";

const ROUTES: Array<[path: string, element: React.ReactNode]> = [
  ["/members", <MemberDirectory key="m" />],
  ["/ledger", <Ledger key="l" chapterId={1} />],
];

const LEAKS = /\b(undefined|NaN|\[object Object\])\b/;

let container: HTMLDivElement;
let root: Root;
let consoleErrors: string[];

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args) =>
    consoleErrors.push(args.map(String).join(" ")));

  // No API during a smoke test. Empty payloads are deliberate: they exercise the
  // empty state, which is what a brand-new chapter sees for its first week.
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ items: [], total: 0, skip: 0, take: 50 }),
  })));

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("every route mounts", () => {
  for (const [path, element] of ROUTES) {
    it(`${path} renders without throwing`, async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      await act(async () => {
        root.render(
          <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={[path]}>
              <Routes><Route path={path} element={element} /></Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });

      expect(consoleErrors.join("\n"), `console errors on ${path}`).toBe("");
      expect(container.innerHTML.length, `${path} rendered empty`).toBeGreaterThan(20);

      const leak = container.innerHTML.match(LEAKS);
      expect(leak?.[0], `${path} leaked "${leak?.[0]}" into the DOM`).toBeUndefined();
    });
  }
});
