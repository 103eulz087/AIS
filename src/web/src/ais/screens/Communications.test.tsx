/**
 * Announcements & memos — officer-vs-member visibility, the withdrawn-reason
 * banner (never a silent disappearance), the memo supersede banner, and the
 * read receipt fired on mount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { AnnouncementList } from "./AnnouncementList";
import { AnnouncementDetail } from "./AnnouncementDetail";
import { MemoDetail } from "./MemoDetail";
import type { Announcement, Memo } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Stubs auth (as the given roles) plus one or more GET responses matched by URL substring.
 * Also records every request made, so a POST (e.g. the read receipt) can be asserted on. */
function stubFetch(roles: string[], responses: Record<string, unknown>) {
  const calls: Array<{ method: string; url: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "TANGLAW", roles }),
      };
    }
    if (method === "POST" && url.includes("/read") && !url.includes("read-receipts")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    for (const [key, body] of Object.entries(responses)) {
      if (url.includes(key)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
  }));
  return calls;
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

const ACTIVE_ANNOUNCEMENT: Announcement = {
  announcementId: 2, title: "General assembly next Sunday",
  body: "Please attend this Sunday's general assembly at the barangay hall.",
  isUrgent: false, urgentTypeId: null, urgentTypeName: null, bloodTypeId: null, bloodTypeName: null,
  publishDateUtc: "2026-09-01T08:00:00Z", expiryDate: null, createdBy: 2,
  editedBy: null, editedDateUtc: null,
  isWithdrawn: false, withdrawnBy: null, withdrawnDateUtc: null, withdrawnReason: null, hasRead: true,
};

const WITHDRAWN_ANNOUNCEMENT: Announcement = {
  announcementId: 1, title: "Urgent: O− blood donor needed",
  body: "A brother's mother needs O− blood at Sta. Rosa Community Hospital.",
  isUrgent: true, urgentTypeId: 1, urgentTypeName: "BloodRequest", bloodTypeId: 2, bloodTypeName: "O-",
  publishDateUtc: "2026-07-30T10:00:00Z", expiryDate: null, createdBy: 2,
  editedBy: null, editedDateUtc: null,
  isWithdrawn: true, withdrawnBy: 2, withdrawnDateUtc: "2026-08-02T09:00:00Z",
  withdrawnReason: "A donor was found — thank you to everyone who responded.", hasRead: false,
};

const MEMO_1: Memo = {
  memoId: 1, memoNumber: "MEMO-2026-0001", subject: "Guidelines on chapter fund handling",
  body: "Original guidance on fund handling.", publishDateUtc: "2026-06-01T00:00:00Z", createdBy: 2,
  supersedesMemoId: null, isSuperseded: true, supersededByMemoId: 2, supersededByMemoNumber: "MEMO-2026-0002",
  hasRead: true,
};

const MEMO_2: Memo = {
  memoId: 2, memoNumber: "MEMO-2026-0002", subject: "Revised guidelines on chapter fund handling",
  body: "Revised guidance on fund handling.", publishDateUtc: "2026-07-01T00:00:00Z", createdBy: 2,
  supersedesMemoId: 1, isSuperseded: false, supersededByMemoId: null, supersededByMemoNumber: null,
  hasRead: false,
};

describe("officer vs. member view", () => {
  it("AnnouncementList shows New announcement for an officer, not for a Member", async () => {
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/announcements": { items: [ACTIVE_ANNOUNCEMENT], total: 1, skip: 0, take: 25 },
    });
    await renderAt("/announcements", "/announcements", <AnnouncementList chapterId={1} />);
    expect(container.textContent).toContain("New announcement");
  });

  it("AnnouncementList hides New announcement from a plain Member", async () => {
    stubFetch(["Member"], {
      "/chapters/1/announcements": { items: [ACTIVE_ANNOUNCEMENT], total: 1, skip: 0, take: 25 },
    });
    await renderAt("/announcements", "/announcements", <AnnouncementList chapterId={1} />);
    expect(container.textContent).not.toContain("New announcement");
  });

  it("AnnouncementDetail shows Edit and Withdraw for an officer", async () => {
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/announcements": { items: [ACTIVE_ANNOUNCEMENT], total: 1, skip: 0, take: 500 },
    });
    await renderAt("/announcements/2", "/announcements/:announcementId", <AnnouncementDetail chapterId={1} />);
    expect(container.textContent).toContain("Edit");
    expect(container.textContent).toContain("Withdraw");
  });

  it("AnnouncementDetail has no Edit or Withdraw for a plain Member", async () => {
    stubFetch(["Member"], {
      "/chapters/1/announcements": { items: [ACTIVE_ANNOUNCEMENT], total: 1, skip: 0, take: 500 },
    });
    await renderAt("/announcements/2", "/announcements/:announcementId", <AnnouncementDetail chapterId={1} />);
    expect(container.textContent).not.toContain("Edit");
    expect(container.textContent).not.toContain("Withdraw");
  });
});

describe("a withdrawn announcement never silently disappears", () => {
  it("shows the withdrawn banner with its reason, not the normal body", async () => {
    stubFetch(["ChapterAdmin"], {
      "/chapters/1/announcements": { items: [WITHDRAWN_ANNOUNCEMENT], total: 1, skip: 0, take: 500 },
    });
    await renderAt("/announcements/1", "/announcements/:announcementId", <AnnouncementDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("Withdrawn");
    expect(text).toContain("A donor was found — thank you to everyone who responded.");
  });
});

describe("a superseded memo shows the supersede banner", () => {
  it("MEMO-2026-0001 points forward at MEMO-2026-0002", async () => {
    stubFetch(["Member"], {
      "/chapters/1/memos": { items: [MEMO_1, MEMO_2], total: 2, skip: 0, take: 500 },
    });
    await renderAt("/memos/1", "/memos/:memoId", <MemoDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("Superseded by");
    expect(text).toContain("MEMO-2026-0002");
  });

  it("MEMO-2026-0002 points back at MEMO-2026-0001", async () => {
    stubFetch(["Member"], {
      "/chapters/1/memos": { items: [MEMO_1, MEMO_2], total: 2, skip: 0, take: 500 },
    });
    await renderAt("/memos/2", "/memos/:memoId", <MemoDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("This supersedes");
    expect(text).toContain("MEMO-2026-0001");
  });
});

describe("marking a document read", () => {
  it("fires the read call once, on mount, for an announcement", async () => {
    const calls = stubFetch(["Member"], {
      "/chapters/1/announcements": { items: [ACTIVE_ANNOUNCEMENT], total: 1, skip: 0, take: 500 },
    });
    await renderAt("/announcements/2", "/announcements/:announcementId", <AnnouncementDetail chapterId={1} />);

    const readCalls = calls.filter(c => c.method === "POST" && c.url.includes("/api/documents/Announcement/2/read"));
    expect(readCalls.length).toBe(1);
  });

  it("fires the read call once, on mount, for a memo", async () => {
    const calls = stubFetch(["Member"], {
      "/chapters/1/memos": { items: [MEMO_1, MEMO_2], total: 2, skip: 0, take: 500 },
    });
    await renderAt("/memos/1", "/memos/:memoId", <MemoDetail chapterId={1} />);

    const readCalls = calls.filter(c => c.method === "POST" && c.url.includes("/api/documents/Memo/1/read"));
    expect(readCalls.length).toBe(1);
  });
});
