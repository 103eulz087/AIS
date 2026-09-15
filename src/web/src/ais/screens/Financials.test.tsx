/**
 * Activities/Expenses/Donations — the donations invariant is the OPPOSITE texture
 * from meetings' contributions (CLAUDE.md invariant #5): a donor's name and amount
 * are meant to be seen. What is still forbidden, carried over from that invariant's
 * spirit, is any per-donor ranking or running total — never built here, so there is
 * nothing to test it NOT doing beyond what the screens simply don't render.
 *
 * These tests instead check: an in-kind donation never renders a peso amount for its
 * in-kind portion; officer-vs-member visibility of create/void controls; a voided
 * record still shows its reason, never hidden; and the expense-create submit button
 * stays disabled until at least one receipt has finished staging.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { DonationList } from "./DonationList";
import { ExpenseDetail } from "./ExpenseDetail";
import { DonationDetail } from "./DonationDetail";
import { ExpenseNew } from "./ExpenseNew";
import type { DonationDetail as DonationDetailModel, ExpenseDetail as ExpenseDetailModel } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Stubs auth (as the given roles) plus GET responses matched by URL substring.
 * A POST to /api/attachments always succeeds with a fresh attachmentStagingId. */
function stubFetch(roles: string[], responses: Record<string, unknown>) {
  let nextStagingId = 100;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "TANGLAW", roles }),
      };
    }
    if (method === "POST" && url === "/api/attachments") {
      return { ok: true, status: 200, json: async () => ({ attachmentStagingId: nextStagingId++ }) };
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

const IN_KIND_DONATION = {
  donationId: 2, activityId: 1, activityName: "Clean-Up Drive", donationDate: "2026-09-13",
  donorName: "Local Sari-Sari Store", donorType: "Business", amount: 0,
  isInKind: true, inKindDescription: "20 sacks of rice", chapterReceiptNo: null,
  recordedBy: 1, isVoided: false,
};

const CASH_DONATION = {
  donationId: 1, activityId: 1, activityName: "Clean-Up Drive", donationDate: "2026-09-13",
  donorName: "Mayor Juan Dela Cruz", donorType: "Government Official", amount: 5000,
  isInKind: false, inKindDescription: null, chapterReceiptNo: "CR-0042",
  recordedBy: 1, isVoided: false,
};

describe("in-kind donations never render a peso amount for the in-kind portion", () => {
  it("DonationList shows the description, not ₱0.00, for an in-kind-only donation", async () => {
    stubFetch(["Member"], {
      "/chapters/1/donations": { items: [IN_KIND_DONATION, CASH_DONATION], total: 2, skip: 0, take: 50 },
    });
    await renderAt("/donations", "/donations", <DonationList chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("In kind — 20 sacks of rice");
    expect(text).not.toContain("₱0.00");
    // The cash donation on the same screen still shows its real amount.
    expect(text).toContain("₱5,000.00");
  });
});

const EXPENSE_FIXTURE: ExpenseDetailModel = {
  expenseId: 1, chapterId: 1, activityId: 1, activityName: "Clean-Up Drive",
  expenseDate: "2026-09-12", payee: "ABC Hardware", description: "Gloves and trash bags",
  amount: 1250, categoryId: 3, categoryName: "Supplies", recordedBy: 1, approvedBy: null,
  isVoided: true,
  attachments: [{ attachmentId: 1, fileName: "receipt1.jpg", fileSize: 204800, uploadedBy: 1 }],
  voidHistory: [{
    expenseVoidId: 1, voidedBy: 1, voidedDateUtc: "2026-09-13T09:30:55Z",
    reason: "Wrong amount entered, correcting.", reversedLedgerEntryId: 6,
  }],
};

const DONATION_FIXTURE: DonationDetailModel = {
  donationId: 3, chapterId: 1, activityId: 1, activityName: "Clean-Up Drive",
  donationDate: "2026-09-13", donorName: "Anonymous Kind Soul", donorType: "Private",
  amount: 1000, isInKind: false, inKindDescription: null, chapterReceiptNo: "CR-0099",
  recordedBy: 1, isVoided: true,
  voidHistory: [{
    donationVoidId: 1, voidedBy: 1, voidedDateUtc: "2026-09-13T10:16:39Z",
    reason: "Duplicate entry from testing.", reversedLedgerEntryId: 9,
  }],
};

describe("a voided expense or donation is never hidden", () => {
  it("ExpenseDetail still shows the record, with its void reason visible", async () => {
    stubFetch(["ChapterAdmin"], { "/chapters/1/expenses/1": EXPENSE_FIXTURE });
    await renderAt("/expenses/1", "/expenses/:expenseId", <ExpenseDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("ABC Hardware");
    expect(text).toContain("Wrong amount entered, correcting.");
    expect(text).toContain("voided");
  });

  it("DonationDetail still shows the record, with its void reason visible", async () => {
    stubFetch(["ChapterAdmin"], { "/chapters/1/donations/3": DONATION_FIXTURE });
    await renderAt("/donations/3", "/donations/:donationId", <DonationDetail chapterId={1} />);

    const text = container.textContent ?? "";
    expect(text).toContain("Anonymous Kind Soul");
    expect(text).toContain("Duplicate entry from testing.");
    expect(text).toContain("voided");
  });
});

describe("officer vs. member view", () => {
  it("DonationList shows New donation for a treasurer, not for a plain Member", async () => {
    stubFetch(["ChapterTreasurer"], {
      "/chapters/1/donations": { items: [CASH_DONATION], total: 1, skip: 0, take: 50 },
    });
    await renderAt("/donations", "/donations", <DonationList chapterId={1} />);
    expect(container.textContent).toContain("New donation");
  });

  it("DonationList hides New donation from a plain Member", async () => {
    stubFetch(["Member"], {
      "/chapters/1/donations": { items: [CASH_DONATION], total: 1, skip: 0, take: 50 },
    });
    await renderAt("/donations", "/donations", <DonationList chapterId={1} />);
    expect(container.textContent).not.toContain("New donation");
  });

  it("ExpenseDetail shows Void for a ChapterAdmin", async () => {
    const notVoided = { ...EXPENSE_FIXTURE, isVoided: false, voidHistory: [] };
    stubFetch(["ChapterAdmin"], { "/chapters/1/expenses/1": notVoided });
    await renderAt("/expenses/1", "/expenses/:expenseId", <ExpenseDetail chapterId={1} />);
    expect(container.textContent).toContain("Void this expense");
  });

  it("ExpenseDetail has no Void button for a ChapterTreasurer (narrower than write access)", async () => {
    const notVoided = { ...EXPENSE_FIXTURE, isVoided: false, voidHistory: [] };
    stubFetch(["ChapterTreasurer"], { "/chapters/1/expenses/1": notVoided });
    await renderAt("/expenses/1", "/expenses/:expenseId", <ExpenseDetail chapterId={1} />);
    expect(container.textContent).not.toContain("Void this expense");
  });
});

describe("ExpenseNew submit stays disabled until a receipt has staged", () => {
  it("enables Save expense only after a picked file finishes uploading", async () => {
    stubFetch(["ChapterAdmin"], {});
    await renderAt("/expenses/new", "/expenses/new", <ExpenseNew chapterId={1} />);

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save expense")) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["fake receipt bytes"], "receipt.jpg", { type: "image/jpeg" });
    // jsdom does not implement DataTransfer/FileList construction, so this fakes just
    // enough of the FileList shape (Array.from(files) is all ExpenseNew ever does with it).
    const fileList = { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) };
    Object.defineProperty(fileInput, "files", { value: fileList, configurable: true });

    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(container.textContent).toContain("✓ Staged");
    const submitAfter = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Save expense")) as HTMLButtonElement;
    expect(submitAfter.disabled).toBe(false);
  });
});
