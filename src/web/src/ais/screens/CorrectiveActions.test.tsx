/**
 * Corrective actions (discipline) — CLAUDE.md invariant #6. The API returns one of two
 * STRUCTURALLY DIFFERENT shapes per case/per timeline entry, decided server-side
 * (ScopeGuard.CanSeeCaseNarrative); these tests check that the UI never invents a
 * visual "there's something hidden here" signal, and that the narrative is rendered
 * (or omitted) purely from whether the key is present on the payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { CaseList } from "./CaseList";
import { CaseNew } from "./CaseNew";
import { CaseDetail } from "./CaseDetail";
import type {
  CorrectiveActionCase, CorrectiveActionCaseResponse, CorrectiveActionTimelineEntry,
} from "@/shared/types";

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

const SHARED_FIELDS = {
  giftName: "SIGWA", memberNumber: "AKR-04-0117-003",
  categoryId: 1, categoryName: "Non-attendance",
  statusName: "Pending", dateFiled: "2026-07-15", resolutionDate: null,
};

const SUMMARY_CASE: CorrectiveActionCase = { caseId: 1, memberId: 3, ...SHARED_FIELDS };

const DETAIL_CASE: CorrectiveActionCase = {
  caseId: 2, memberId: 4, ...SHARED_FIELDS,
  content: "Has not attended six consecutive regular meetings.",
  resolutionNotes: null, filedBy: 1, filedByGiftName: "TANGLAW",
};

describe("CaseList — the two shapes render identically for shared fields", () => {
  it("a summary-shape row and a detail-shape row differ only in the extra fields, never in styling", async () => {
    stubFetch(["Member"], {
      "/chapters/1/corrective-actions?": {
        items: [SUMMARY_CASE, DETAIL_CASE], total: 2, skip: 0, take: 25,
      },
    });
    await renderAt("/corrective-actions", "/corrective-actions", <CaseList chapterId={1} />);

    const summaryRow = container.querySelector('[data-testid="case-row-1"]');
    const detailRow = container.querySelector('[data-testid="case-row-2"]');
    expect(summaryRow).toBeTruthy();
    expect(detailRow).toBeTruthy();

    // Same shared fields render identically — same tag, same style attribute tree
    // shape, same text for every field the list is entitled to show.
    expect(summaryRow?.innerHTML.replace(/case-row-\d+|corrective-actions\/\d+/g, ""))
      .toBe(detailRow?.innerHTML.replace(/case-row-\d+|corrective-actions\/\d+/g, ""));

    // No narrative content, and — critically — no lock icon, no "restricted" text,
    // no placeholder anywhere hinting a hidden narrative exists.
    const text = container.textContent ?? "";
    expect(text).not.toContain("Has not attended");
    expect(text).not.toContain("TANGLAW");
    expect(text).not.toMatch(/restricted|hidden|locked|🔒/i);
  });

  it("File a new case is absent for a plain Member", async () => {
    stubFetch(["Member"], {
      "/chapters/1/corrective-actions?": { items: [SUMMARY_CASE], total: 1, skip: 0, take: 25 },
    });
    await renderAt("/corrective-actions", "/corrective-actions", <CaseList chapterId={1} />);
    expect(container.textContent).not.toContain("File a case");
  });

  it("File a new case is present for a ChapterAdmin", async () => {
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/corrective-actions?": { items: [SUMMARY_CASE], total: 1, skip: 0, take: 25 },
    });
    await renderAt("/corrective-actions", "/corrective-actions", <CaseList chapterId={1} />);
    expect(container.textContent).toContain("File a case");
  });
});

describe("CaseDetail — the narrative is present or absent by key, never by null-check", () => {
  const SUMMARY_RESPONSE: CorrectiveActionCaseResponse = {
    case: SUMMARY_CASE,
    timeline: [{ updateId: 1, updateDateUtc: "2026-07-15T09:00:00Z", statusName: "Pending" }],
  };

  const DETAIL_RESPONSE: CorrectiveActionCaseResponse = {
    case: DETAIL_CASE,
    timeline: [
      { updateId: 1, updateDateUtc: "2026-07-15T09:00:00Z", statusName: "Pending",
        updatedBy: 1, updatedByGiftName: "TANGLAW", notes: "Case filed." },
    ],
  };

  it("renders no 'What happened' section at all when the fixture has no content key", async () => {
    stubFetch(["Member"], { "/chapters/1/corrective-actions/1": SUMMARY_RESPONSE });
    await renderAt("/corrective-actions/1", "/corrective-actions/:caseId", <CaseDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("SIGWA");
    expect(text).not.toContain("What happened");
    expect(text).not.toMatch(/restricted|hidden|locked|🔒/i);
  });

  it("renders the 'What happened' narrative when content is present", async () => {
    stubFetch(["ChapterAdmin"], { "/chapters/1/corrective-actions/2": DETAIL_RESPONSE });
    await renderAt("/corrective-actions/2", "/corrective-actions/:caseId", <CaseDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("What happened");
    expect(text).toContain("Has not attended six consecutive regular meetings.");
    expect(text).toContain("TANGLAW");
  });

  it("Add update is absent for a plain Member", async () => {
    stubFetch(["Member"], { "/chapters/1/corrective-actions/1": SUMMARY_RESPONSE });
    await renderAt("/corrective-actions/1", "/corrective-actions/:caseId", <CaseDetail chapterId={1} />);
    expect(container.textContent).not.toContain("Add update");
  });

  it("Add update is present for a ChapterAdmin", async () => {
    stubFetch(["ChapterAdmin"], { "/chapters/1/corrective-actions/1": SUMMARY_RESPONSE });
    await renderAt("/corrective-actions/1", "/corrective-actions/:caseId", <CaseDetail chapterId={1} />);
    expect(container.textContent).toContain("Add update");
  });

  it("renders per-entry visibility on a mixed timeline, driven by presence not a page-level flag", async () => {
    const mixedTimeline: CorrectiveActionTimelineEntry[] = [
      { updateId: 1, updateDateUtc: "2026-07-15T09:00:00Z", statusName: "Pending",
        updatedBy: 1, updatedByGiftName: "TANGLAW", notes: "Case filed by the Chapter President." },
      { updateId: 2, updateDateUtc: "2026-07-28T09:00:00Z", statusName: "Under Review" },
    ];
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/corrective-actions/2": { case: DETAIL_CASE, timeline: mixedTimeline },
    });
    await renderAt("/corrective-actions/2", "/corrective-actions/:caseId", <CaseDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("Case filed by the Chapter President.");
    expect(text).toContain("TANGLAW");
    expect(text).toContain("Under Review");
  });
});

describe("CaseNew — ChapterAdmin only", () => {
  it("a plain Member gets a plain access-denied state on direct navigation, not a crash", async () => {
    stubFetch(["Member"], {});
    await renderAt("/corrective-actions/new", "/corrective-actions/new", <CaseNew chapterId={1} />);

    expect(container.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("File case");
  });

  it("a ChapterAdmin sees the filing form", async () => {
    stubFetch(["ChapterAdmin"], {
      "/api/corrective-action-categories": [{ categoryId: 1, categoryName: "Non-attendance" }],
    });
    await renderAt("/corrective-actions/new", "/corrective-actions/new", <CaseNew chapterId={1} />);

    expect(container.textContent).toContain("File a corrective action");
    expect(container.textContent).toContain("What happened");
    expect(container.querySelector("button[type=submit]")?.textContent).toBe("File case");
  });
});
