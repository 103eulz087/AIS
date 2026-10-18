/**
 * Phone fit: on a narrow screen the per-chapter report becomes stacked cards (no <table>),
 * with the same counts; on a wide screen it stays a table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { MemberPaymentTagStats } from "./MemberPaymentTagStats";
import type { CouncilSeatPermissions } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

const STATS = [
  { chapterId: 1, chapterName: "Sta. Rosa Chapter", membershipYear: 2026, totalMembers: 10, paidCount: 6, freeCount: 2, unpaidCount: 2 },
];

function stubFetch() {
  const councilSeats: CouncilSeatPermissions[] = [
    { councilId: 1, councilName: "National Council", officeName: "President", permissions: ["MemberPaymentTag.Read"], canManagePermissions: true },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles: ["CouncilAdmin"], councilSeats }),
      };
    }
    if (url.includes("/api/member-payment-tags/stats")) {
      return { ok: true, status: 200, json: async () => STATS };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches, media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null,
  }));
}

async function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter><MemberPaymentTagStats /></MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  stubFetch();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MemberPaymentTagStats layout", () => {
  it("shows stacked cards, not a table, on a phone", async () => {
    mockMatchMedia(true);
    await renderScreen();
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Sta. Rosa Chapter");
    expect(container.textContent).toContain("80%");
  });

  it("keeps the table on a wide screen", async () => {
    mockMatchMedia(false);
    await renderScreen();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("Sta. Rosa Chapter");
  });
});
