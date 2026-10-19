/**
 * The links between the two halves of the app (2026-10-19): a council officer in the member
 * app can open the Council Portal, and anyone in the Portal who belongs to a chapter can open
 * the member app (where its own first-login tour starts). A plain member never sees a Portal
 * link.
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
let me: Record<string, unknown>;

const seat = {
  councilId: 1, councilName: "National Council", officeName: "President",
  permissions: ["ChapterRegistration.Review"], canManagePermissions: true,
};

beforeEach(() => {
  window.localStorage.clear();
  me = { memberId: 5, chapterId: 1, chapterName: "Test", giftName: "TANGLAW", roles: ["Member"], councilSeats: [] };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes("/api/auth/refresh")) return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    if (u.includes("/api/auth/me")) return { ok: true, status: 200, json: async () => me };
    // Both tours already seen, so no tour overlay gets in the way.
    if (u.includes("/api/members/me/tutorials")) {
      return { ok: true, status: 200, json: async () => [
        { tourKey: "ais-welcome", tourVersion: 99, outcome: "Completed", finishedDate: "2026-10-19T00:00:00Z" },
        { tourKey: "portal-welcome", tourVersion: 99, outcome: "Completed", finishedDate: "2026-10-19T00:00:00Z" },
      ] };
    }
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

async function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<AppShell />}><Route index element={<div>home</div>} /></Route>
              <Route path="/portal" element={<PortalShell />}><Route path="x" element={<div>x</div>} /></Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}

const linkTo = (href: string, text: string) =>
  [...container.querySelectorAll("a")].find(a => a.getAttribute("href") === href && a.textContent?.includes(text)) ?? null;

describe("links between the member app and the Council Portal", () => {
  it("shows a council officer the Council Portal link in the member app", async () => {
    me = { ...me, roles: ["CouncilAdmin"], councilSeats: [seat] };
    await mount("/");
    expect(linkTo("/portal", "Council Portal")).not.toBeNull();
  });

  it("never shows a plain member a Portal link", async () => {
    await mount("/");
    expect(linkTo("/portal", "Council Portal")).toBeNull();
  });

  it("shows the member app link in the Portal to an officer who belongs to a chapter", async () => {
    me = { ...me, roles: ["CouncilAdmin"], councilSeats: [seat] };
    await mount("/portal/x");
    expect(linkTo("/", "Open the member app")).not.toBeNull();
  });

  it("hides the member app link from someone with no chapter", async () => {
    me = { ...me, chapterId: 0, roles: ["CouncilAdmin"], councilSeats: [seat] };
    await mount("/portal/x");
    expect(linkTo("/", "Open the member app")).toBeNull();
  });
});
