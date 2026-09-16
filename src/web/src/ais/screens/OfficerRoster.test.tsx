/**
 * The authenticated annual officer-turnover filing (§7A.4, decision E1a) — ChapterAdmin
 * only. Anyone else, including the read-only ChapterAuditor, gets the same plain
 * "you don't have access" empty state ApplicationQueue/ApplicationDetail already use for
 * their own equivalent gate (Applications.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { OfficerRoster } from "./OfficerRoster";
import type { Paged } from "@/shared/api";
import type { Member } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface FetchRule { status: number; body: unknown }

/** Same auth-stubbing convention as Applications.test.tsx's own stubFetch. */
function stubFetch(roles: string[] | null, rules: Array<[matchMethodAndUrl: string, rule: FetchRule]>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/auth/refresh")) {
      if (!roles) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      if (!roles) return { ok: false, status: 401, json: async () => ({}) };
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "TANGLAW", roles }),
      };
    }

    for (const [key, rule] of rules) {
      const spaceIndex = key.indexOf(" ");
      const ruleMethod = spaceIndex === -1 ? "GET" : key.slice(0, spaceIndex);
      const ruleUrl = spaceIndex === -1 ? key : key.slice(spaceIndex + 1);
      if (method === ruleMethod && url.includes(ruleUrl)) {
        return { ok: rule.status >= 200 && rule.status < 300, status: rule.status, json: async () => rule.body };
      }
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 500 }) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderAt(path: string, routePath: string, element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes><Route path={routePath} element={element} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

beforeEach(() => {
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

const CHAPTER_MEMBERS: Paged<Member> = {
  items: [
    { memberId: 1, giftName: "TANGLAW", memberNumber: "AKR-04-0117-001", chapterId: 1, chapterName: "Test Chapter", status: "Active" },
    { memberId: 2, giftName: "BAGWIS", memberNumber: "AKR-04-0117-002", chapterId: 1, chapterName: "Test Chapter", status: "Active" },
  ],
  total: 2, skip: 0, take: 500,
};

describe("OfficerRoster — role gating", () => {
  it("a ChapterAdmin sees the annual officer update form", async () => {
    stubFetch(["ChapterAdmin"], [
      ["GET /api/members", { status: 200, body: CHAPTER_MEMBERS }],
    ]);
    await renderAt("/officer-roster", "/officer-roster", <OfficerRoster />);

    expect(container.textContent).toContain("Annual officer update");
    expect(container.textContent).not.toContain("You don't have access to this");
  });

  it("a plain Member sees the same 'you don't have access' empty state, not a crash", async () => {
    stubFetch(["Member"], []);
    await renderAt("/officer-roster", "/officer-roster", <OfficerRoster />);

    expect(container.textContent).toContain("You don't have access to this");
    expect(container.textContent).toContain("Only the chapter admin can file the annual officer update.");
    expect(container.textContent).not.toContain("Annual officer update");
  });

  it("a read-only ChapterAuditor sees the same empty state as any other non-admin — never the form", async () => {
    stubFetch(["ChapterAuditor"], []);
    await renderAt("/officer-roster", "/officer-roster", <OfficerRoster />);

    expect(container.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("Annual officer update");
  });

  it("a signed-out visitor sees the access-denied state rather than the form", async () => {
    stubFetch(null, []);
    await renderAt("/officer-roster", "/officer-roster", <OfficerRoster />);

    expect(container.textContent).toContain("You don't have access to this");
  });
});
