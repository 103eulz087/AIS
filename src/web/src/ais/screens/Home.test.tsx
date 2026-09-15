/**
 * Home dashboard — role-aware quick actions, the single sanctioned fund-balance
 * aggregate (CLAUDE.md invariant #5), and the same "never show arrears/collection
 * rate" wording rule that governs Meetings.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { Home } from "./Home";

// Contributions are voluntary — none of this vocabulary may ever appear on the
// dashboard, even alongside a real, visible chapter balance.
const BLOCKLIST =
  /arrears|unpaid|overdue|owes?\b|owing|balance due|delinquent|shortfall|deficien|collection rate|participation rate|did not (pay|contribute)|non-contributor/i;

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Stubs auth (as the given roles) plus one or more GET responses matched by URL substring. */
function stubFetch(roles: string[], responses: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "TANGLAW", roles }),
      };
    }
    if (url.includes("/ledger/summary")) {
      const body = responses["/ledger/summary"] ?? { cashIn: 40000, cashOut: 1580, balance: 38420 };
      return { ok: true, status: 200, json: async () => body };
    }
    for (const [key, body] of Object.entries(responses)) {
      if (url.includes(key)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderHome(chapterId = 1) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes><Route path="/" element={<Home chapterId={chapterId} />} /></Routes>
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

describe("quick actions match the officer's specific roles", () => {
  it("a ChapterTreasurer sees New expense and New donation, not New meeting or New announcement", async () => {
    stubFetch(["ChapterTreasurer"]);
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).toContain("New expense");
    expect(text).toContain("New donation");
    expect(text).not.toContain("New meeting");
    expect(text).not.toContain("New announcement");
  });

  it("a ChapterAdmin sees all four quick actions", async () => {
    stubFetch(["ChapterAdmin"]);
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).toContain("New meeting");
    expect(text).toContain("New expense");
    expect(text).toContain("New donation");
    expect(text).toContain("New announcement");
  });

  it("a plain Member sees no quick-actions row at all", async () => {
    stubFetch(["Member"]);
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).not.toContain("Quick actions");
    expect(text).not.toContain("New meeting");
    expect(text).not.toContain("New expense");
    expect(text).not.toContain("New donation");
    expect(text).not.toContain("New announcement");
  });
});

describe("the chapter fund balance", () => {
  it("renders via peso() and only appears for an officer", async () => {
    stubFetch(["ChapterAdmin"], { "/ledger/summary": { cashIn: 40000, cashOut: 1580, balance: 38420 } });
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).toContain("CHAPTER FUNDS");
    expect(text).toContain("₱38,420.00");
  });

  it("is absent for a plain Member (no chapter balance foregrounded on login)", async () => {
    stubFetch(["Member"], { "/ledger/summary": { cashIn: 40000, cashOut: 1580, balance: 38420 } });
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).not.toContain("CHAPTER FUNDS");
    expect(text).not.toContain("₱38,420.00");
  });
});

describe("empty states", () => {
  it("a brand-new chapter shows plain 'nothing here yet' text, never an error, and still shows quick actions", async () => {
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/meetings": { items: [], total: 0, skip: 0, take: 4 },
      "/chapters/1/announcements": { items: [], total: 0, skip: 0, take: 4 },
    });
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).toContain("No meetings recorded yet");
    expect(text).toContain("Nothing posted yet");
    expect(text).not.toContain("That did not load");
    expect(text).toContain("New meeting");
  });
});

describe("the chapter chat link", () => {
  it("appears for a member with a chapter", async () => {
    stubFetch(["Member"]);
    await renderHome(1);

    const text = container.textContent ?? "";
    expect(text).toContain("Open the chapter chat");
  });

  it("is hidden for a detached member (chapterId 0 — his chapter went dormant)", async () => {
    stubFetch(["Member"]);
    await renderHome(0);

    const text = container.textContent ?? "";
    expect(text).not.toContain("Open the chapter chat");
  });
});

describe("no forbidden wording anywhere on the dashboard", () => {
  it("officer view, with real data, never uses arrears/collection-rate wording", async () => {
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/meetings": {
        items: [{
          meetingId: 1, subject: "Regular Chapter Meeting — September", meetingDate: "2026-09-13",
          location: "Barangay Hall", isFinalized: true, finalizedDateUtc: "2026-09-13T12:00:00Z",
          collectionTotal: 300, presentCount: 2, lateCount: 0,
        }],
        total: 1, skip: 0, take: 4,
      },
      "/chapters/1/announcements": {
        items: [{
          announcementId: 1, title: "General assembly next Sunday",
          body: "Please attend.", isUrgent: false, urgentTypeId: null, urgentTypeName: null,
          bloodTypeId: null, bloodTypeName: null, publishDateUtc: "2026-09-01T08:00:00Z",
          expiryDate: null, createdBy: 2, editedBy: null, editedDateUtc: null,
          isWithdrawn: false, withdrawnBy: null, withdrawnDateUtc: null, withdrawnReason: null,
          hasRead: false,
        }],
        total: 1, skip: 0, take: 4,
      },
      "/ledger/summary": { cashIn: 40000, cashOut: 1580, balance: 38420 },
    });
    await renderHome();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(BLOCKLIST);
  });
});
