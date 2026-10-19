/**
 * When the welcome tour starts by itself: only for a signed-in member, only when the server
 * says he has not seen this version, and never on a malformed answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { AppShell } from "@/shared/AppShell";
import { PortalShell } from "@/portal/PortalShell";

let container: HTMLDivElement;
let root: Root;
let tutorials: unknown;

/** Wait until the tutorials list has been asked for, then past the 600ms start delay. */
async function settleAfterTutorials() {
  const asked = () => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .some(c => String(c[0]).includes("/api/members/me/tutorials"));
  for (let i = 0; i < 100 && !asked(); i++) await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  // Short acts, not one long one: React only flushes effects when an act scope exits.
  for (let i = 0; i < 24; i++) await act(async () => { await new Promise(r => setTimeout(r, 40)); });
}

function url(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

beforeEach(() => {
  window.localStorage.clear();
  tutorials = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const u = url(input);
    if (u.includes("/api/auth/refresh")) return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    if (u.includes("/api/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ memberId: 5, chapterId: 1, chapterName: "Test", giftName: "TANGLAW", roles: ["Member"], councilSeats: [] }) };
    }
    // Sending a finish report always fails here (offline), so a pending one stays pending.
    if (u.includes("/finish")) return { ok: false, status: 500, json: async () => ({}) };
    if (u.includes("/api/members/me/tutorials")) return { ok: true, status: 200, json: async () => tutorials };
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
  }));
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

async function mountAis(path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<AppShell />}>
                <Route index element={<div>home</div>} />
                <Route path="members" element={<div>members</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settleAfterTutorials();
}

async function mountPortal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/portal/x"]}>
            <Routes>
              <Route path="/portal" element={<PortalShell />}>
                <Route path="x" element={<div>x</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settleAfterTutorials();
}

const dialogText = () => { return document.querySelector('[role="dialog"]')?.textContent ?? null; };

describe("AIS welcome tour auto-start", () => {
  it("starts on Home when the member has no row for it", async () => {
    tutorials = [];
    await mountAis();
    expect(dialogText()).toContain("Welcome, TANGLAW!");
  });

  it("starts again when his row is for an older version", async () => {
    tutorials = [{ tourKey: "ais-welcome", tourVersion: 0, outcome: "Completed", finishedDate: "2026-01-01T00:00:00Z" }];
    await mountAis();
    expect(dialogText()).toContain("Welcome, TANGLAW!");
  });

  it("does not start when he has already seen the current version", async () => {
    tutorials = [{ tourKey: "ais-welcome", tourVersion: 2, outcome: "Skipped", finishedDate: "2026-01-01T00:00:00Z" }];
    await mountAis();
    expect(dialogText()).toBeNull();
  });

  it("does not start when the answer is not a list", async () => {
    tutorials = { items: [], total: 0 };
    await mountAis();
    expect(dialogText()).toBeNull();
  });

  it("does not start away from Home", async () => {
    tutorials = [];
    await mountAis("/members");
    expect(dialogText()).toBeNull();
  });

  it("does not start while a finish report is still waiting to be sent from this browser", async () => {
    tutorials = [];
    window.localStorage.setItem("akrho.tour.pending",
      JSON.stringify([{ memberId: 5, tourKey: "ais-welcome", tourVersion: 2, outcome: "Skipped" }]));
    await mountAis();
    expect(dialogText()).toBeNull();
  });
});

describe("Portal welcome tour auto-start", () => {
  it("starts when there is no row for it", async () => {
    tutorials = [{ tourKey: "ais-welcome", tourVersion: 2, outcome: "Completed", finishedDate: "2026-01-01T00:00:00Z" }];
    await mountPortal();
    expect(dialogText()).toContain("Welcome, TANGLAW!");
    expect(dialogText()).toContain("Council Portal");
  });

  it("does not start once seen", async () => {
    tutorials = [{ tourKey: "portal-welcome", tourVersion: 2, outcome: "Completed", finishedDate: "2026-01-01T00:00:00Z" }];
    await mountPortal();
    expect(dialogText()).toBeNull();
  });

  it("does not start on a malformed answer", async () => {
    tutorials = {};
    await mountPortal();
    expect(dialogText()).toBeNull();
  });
});
