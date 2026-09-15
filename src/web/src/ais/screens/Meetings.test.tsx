/**
 * Meetings module — invariant #5 (contributions are voluntary) is easiest to
 * accidentally violate here, so these tests check the wording and the markup
 * directly rather than trusting a visual review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { MeetingList } from "./MeetingList";
import { MeetingDetail } from "./MeetingDetail";

// Contributions are voluntary — none of this vocabulary may ever appear, even
// alongside real, visible peso amounts (that is the point of the test).
const BLOCKLIST =
  /arrears|unpaid|overdue|owes?\b|owing|balance due|delinquent|shortfall|deficien|collection rate|did not (pay|contribute)|non-contributor/i;

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Stubs auth (as the given roles) plus one or more API responses matched by URL substring. */
function stubFetch(roles: string[], responses: Record<string, unknown>) {
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
    for (const [key, body] of Object.entries(responses)) {
      if (url.includes(key)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderStatic(path: string, element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes><Route path={path} element={element} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** MeetingDetail reads its id from the route, so this registers the real dynamic pattern. */
async function renderMeetingDetail(meetingId: number, element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[`/meetings/${meetingId}`]}>
            <Routes><Route path="/meetings/:meetingId" element={element} /></Routes>
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

const MEETING_FIXTURE = {
  meetingId: 42, chapterId: 1, subject: "Regular Chapter Meeting — September", meetingDate: "2026-09-13",
  body: "1. Reading of previous minutes\n2. Treasurer's report", location: "Barangay Hall, San Isidro",
  isFinalized: true, finalizedBy: 2, finalizedDateUtc: "2026-09-13T12:00:00Z",
  createdBy: 2, createdDateUtc: "2026-09-10T09:00:00Z",
  ledgerEntryId: 99, ledgerEntryIsReversed: false,
  attendance: [
    { memberId: 1, giftName: "TANGLAW", memberNumber: "AKR-04-0117-001", statusName: "Active",
      attendanceStatusId: 1, fundAmount: 0, checkedInAtUtc: "2026-09-13T11:00:00Z" },
    { memberId: 2, giftName: "BAGWIS", memberNumber: "AKR-04-0117-002", statusName: "Active",
      attendanceStatusId: 1, fundAmount: 300, checkedInAtUtc: "2026-09-13T11:05:00Z" },
    { memberId: 3, giftName: "SIGWA", memberNumber: "AKR-04-0117-003", statusName: "Active",
      attendanceStatusId: null, fundAmount: null, checkedInAtUtc: null },
  ],
  reopenHistory: [
    { meetingReopenId: 1, reopenedBy: 2, reopenedDateUtc: "2026-09-14T08:00:00Z",
      reason: "Wrong amount recorded for one brother; correcting after the fact.", reversedLedgerEntryId: 99 },
  ],
};

const DRAFT_FIXTURE = { ...MEETING_FIXTURE, isFinalized: false, ledgerEntryId: null, reopenHistory: [] };

describe("meetings screens never use arrears/collection-rate wording", () => {
  it("MeetingDetail shows real peso amounts with none of the blocked words", async () => {
    stubFetch(["Member"], { "/chapters/1/meetings/42": MEETING_FIXTURE });
    await renderMeetingDetail(42, <MeetingDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("₱0.00");
    expect(text).toContain("₱300.00");
    expect(text).not.toMatch(BLOCKLIST);
  });

  it("MeetingList shows real peso amounts with none of the blocked words", async () => {
    stubFetch(["Member"], {
      "/chapters/1/meetings?": {
        items: [
          { meetingId: 1, subject: "Regular Meeting — August", meetingDate: "2026-08-09", location: "Hall",
            isFinalized: true, finalizedDateUtc: "2026-08-09T12:00:00Z",
            collectionTotal: 300, presentCount: 2, lateCount: 0 },
          { meetingId: 2, subject: "Special Meeting", meetingDate: "2026-08-01", location: "Hall",
            isFinalized: false, finalizedDateUtc: null,
            collectionTotal: 0, presentCount: 0, lateCount: 0 },
        ],
        total: 2, skip: 0, take: 25,
      },
    });
    await renderStatic("/meetings", <MeetingList chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("₱300.00");
    expect(text).toContain("₱0.00");
    expect(text).not.toMatch(BLOCKLIST);
  });
});

describe("attendance amount cells", () => {
  it("render a ₱0 row and a ₱300 row with identical markup", async () => {
    stubFetch(["Member"], { "/chapters/1/meetings/42": MEETING_FIXTURE });
    await renderMeetingDetail(42, <MeetingDetail chapterId={1} />);

    const zeroCell = container.querySelector('[data-testid="amount-1"]');
    const threeHundredCell = container.querySelector('[data-testid="amount-2"]');

    expect(zeroCell).toBeTruthy();
    expect(threeHundredCell).toBeTruthy();
    expect(zeroCell?.tagName).toBe(threeHundredCell?.tagName);
    expect(zeroCell?.className).toBe(threeHundredCell?.className);
    expect(zeroCell?.getAttribute("style")).toBe(threeHundredCell?.getAttribute("style"));
    expect(zeroCell?.textContent).toBe("₱0.00");
    expect(threeHundredCell?.textContent).toBe("₱300.00");
  });
});

describe("officer vs. member view", () => {
  it("shows edit controls and Finalize for a ChapterAdmin", async () => {
    stubFetch(["ChapterAdmin"], { "/chapters/1/meetings/42": DRAFT_FIXTURE });
    await renderMeetingDetail(42, <MeetingDetail chapterId={1} />);

    expect(container.querySelector('button[aria-label="Present"]')).toBeTruthy();
    expect(container.textContent).toContain("Finalize meeting");
  });

  it("is read-only, with no edit controls, for a plain Member", async () => {
    stubFetch(["Member"], { "/chapters/1/meetings/42": DRAFT_FIXTURE });
    await renderMeetingDetail(42, <MeetingDetail chapterId={1} />);

    expect(container.querySelector('button[aria-label="Present"]')).toBeNull();
    expect(container.textContent).not.toContain("Finalize meeting");
    expect(container.textContent).not.toContain("Save");
  });
});
