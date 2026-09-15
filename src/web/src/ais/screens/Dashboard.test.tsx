/**
 * Chapter dashboard — CLAUDE.md invariant #5 (contributions are voluntary) is at its
 * highest risk on this screen: it is the one place a collection rate, a per-member
 * contribution figure or an attendance leaderboard could slip in "for free" from data
 * the API already returns in aggregate. These tests check the wording and the label
 * separation directly rather than trusting a visual review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { Dashboard } from "./Dashboard";
import type { DashboardSummary } from "@/shared/types";

// Contributions are voluntary — none of this vocabulary may ever appear on the
// dashboard, even alongside real, non-zero figures.
const BLOCKLIST = /collection rate|arrears|top donor|top contributor|most active|least active|ranking/i;

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function stubFetch(dashboard: DashboardSummary) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "TANGLAW", roles: ["Member"],
        }),
      };
    }
    if (url.includes("/dashboard")) {
      return { ok: true, status: 200, json: async () => dashboard };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/dashboard"]}>
            <Routes><Route path="/dashboard" element={<Dashboard chapterId={1} />} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

// Mirrors a real, reconciled chapter: 8 members, 1 meeting held (5 present of 5 on the
// sheet), 2 corrective-action cases (1 Pending, 1 Reconciled). currentBalance is
// deliberately DIFFERENT from closingBalance so the label-separation test is meaningful.
const REAL_FIXTURE: DashboardSummary = {
  fromDate: "2026-08-09", toDate: "2027-08-08",
  financial: {
    openingBalance: 10000, periodIn: 5000, periodOut: 1200, closingBalance: 13800,
    currentBalance: 20000,
    inFromMeetings: 3000, inFromDonations: 2000, inOther: 0,
    outOnExpenses: 1200, outOther: 0,
  },
  membership: {
    total: 8, pending: 1, approved: 1, active: 5, inactive: 1, suspended: 0, rejected: 0,
    newThisPeriod: 2,
  },
  activity: { meetingsHeld: 1, totalPresent: 5, totalOnSheets: 5, averagePresentPerMeeting: 5 },
  correctiveActionCounts: [
    { statusName: "Pending", caseCount: 1 }, { statusName: "Under Review", caseCount: 0 },
    { statusName: "Reconciled", caseCount: 1 }, { statusName: "Dismissed", caseCount: 0 },
  ],
};

const EMPTY_FIXTURE: DashboardSummary = {
  fromDate: "2026-08-09", toDate: "2027-08-08",
  financial: {
    openingBalance: 0, periodIn: 0, periodOut: 0, closingBalance: 0, currentBalance: 0,
    inFromMeetings: 0, inFromDonations: 0, inOther: 0, outOnExpenses: 0, outOther: 0,
  },
  membership: {
    total: 0, pending: 0, approved: 0, active: 0, inactive: 0, suspended: 0, rejected: 0,
    newThisPeriod: 0,
  },
  activity: { meetingsHeld: 0, totalPresent: 0, totalOnSheets: 0, averagePresentPerMeeting: 0 },
  correctiveActionCounts: [
    { statusName: "Pending", caseCount: 0 }, { statusName: "Under Review", caseCount: 0 },
    { statusName: "Reconciled", caseCount: 0 }, { statusName: "Dismissed", caseCount: 0 },
  ],
};

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

describe("the financial section always labels which balance is which", () => {
  it("never shows a bare 'balance' — period figures and currentBalance are separately labelled", async () => {
    stubFetch(REAL_FIXTURE);
    await renderDashboard();

    const text = container.textContent ?? "";
    expect(text).toContain("Opening balance");
    expect(text).toContain("Closing balance");
    expect(text).toContain("CURRENT CHAPTER FUNDS");
    // The two money figures are genuinely different in this fixture — both must appear,
    // proving the closing figure was never mistaken for/collapsed into the current one.
    expect(text).toContain("₱13,800.00"); // closingBalance
    expect(text).toContain("₱20,000.00"); // currentBalance
    // "the balance" bare and unlabelled — the one phrasing invariant #5 forbids here.
    expect(text.toLowerCase()).not.toContain("the balance");
  });
});

describe("attendance renders headcounts alongside the average, never alone", () => {
  it("shows the average AND both raw headcounts in the same section", async () => {
    stubFetch(REAL_FIXTURE);
    await renderDashboard();

    const tile = container.querySelector('[data-testid="tile-attendance"]');
    expect(tile).toBeTruthy();
    const tileText = tile?.textContent ?? "";

    expect(tileText).toContain("Average 5 present per meeting");
    expect(tileText).toContain("5 present of 5 on the sheet");
    expect(tileText).toContain("across 1 meeting");

    // A percentage may appear, but only alongside the two headcounts above, never as
    // the sole figure — and it must not be the only number a screen reader/eye lands on.
    if (/%/.test(tileText)) {
      expect(tileText).toContain("present of");
    }
  });

  it("a brand-new chapter with no meetings shows plain copy, never a bare 0.0 average", async () => {
    stubFetch(EMPTY_FIXTURE);
    await renderDashboard();

    const tile = container.querySelector('[data-testid="tile-attendance"]');
    const tileText = tile?.textContent ?? "";
    expect(tileText).toContain("No meetings recorded yet.");
    expect(tileText).not.toMatch(/0(\.0)?\s*%/);
    expect(tileText).not.toContain("Average 0 present");
  });
});

describe("no forbidden wording anywhere on the dashboard", () => {
  it("real, non-zero data across every group never uses collection-rate/ranking wording", async () => {
    stubFetch(REAL_FIXTURE);
    await renderDashboard();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(BLOCKLIST);
  });
});

describe("empty-chapter fixture", () => {
  it("renders plain empty-state copy per group, never a raw 0%/0.0 with no explanation", async () => {
    stubFetch(EMPTY_FIXTURE);
    await renderDashboard();

    const text = container.textContent ?? "";
    expect(text).toContain("No fund activity recorded in this period yet.");
    expect(text).toContain("No members recorded in this chapter yet.");
    expect(text).toContain("No meetings recorded yet.");
    expect(text).toContain("No corrective actions on file.");
    // Every corrective-action status tile is still shown, even at zero — never hidden.
    expect(text).toContain("Pending");
    expect(text).toContain("Under Review");
    expect(text).toContain("Reconciled");
    expect(text).toContain("Dismissed");
  });
});

describe("membership tiles drill through to the real filtered list", () => {
  it("the Inactive tile links to /members?statusId=4, the real Inactive status id", async () => {
    stubFetch(REAL_FIXTURE);
    await renderDashboard();

    const tile = container.querySelector('[data-testid="tile-members-status-4"]');
    expect(tile).toBeTruthy();
    expect(tile?.textContent).toContain("Inactive");
    expect(tile?.getAttribute("href")).toBe("/members?statusId=4");
  });

  it("the Active tile links to /members?statusId=3", async () => {
    stubFetch(REAL_FIXTURE);
    await renderDashboard();

    const tile = container.querySelector('[data-testid="tile-members-status-3"]');
    expect(tile?.getAttribute("href")).toBe("/members?statusId=3");
  });
});
