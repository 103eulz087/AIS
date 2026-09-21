/**
 * Member self-registration + Chapter Admin approval (CLAUDE.md invariant #13 — a
 * member is created by his chapter, and this module IS that path).
 *
 * Covers: JoinChapter's client-side required-field validation (the only way to apply
 * now that the generic /apply picker has been removed), ApplyStatus's uniform 404
 * message (never distinguishing a wrong reference from a wrong mobile number),
 * ChapterAdmin-only access to the review queue/detail, the seconder's honest "Not yet
 * confirmed" wording, and the show-once enrolment link panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { JoinChapter } from "./JoinChapter";
import { ApplyStatus } from "./ApplyStatus";
import { ApplicationQueue } from "./ApplicationQueue";
import { ApplicationDetail } from "./ApplicationDetail";
import type {
  ApproveMembershipApplicationResponse, MembershipApplicationDetail as ApplicationDetailModel,
} from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface FetchRule { status: number; body: unknown }

/** Stubs auth (as the given roles, or signed-out if roles is null) plus GET/POST rules
 * matched by URL substring, in order. Falls through to an empty paged result. */
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

// React installs its own "value" property descriptor on a controlled input/textarea/
// select instance to track whether a change actually happened. Setting `.value =`
// directly goes through THAT wrapper, which updates its own tracker too, so the
// change/input event that follows looks like a no-op to React and onChange never
// fires. Going through the underlying prototype's native setter first (bypassing
// React's per-instance wrapper), THEN dispatching the event, is the standard jsdom
// workaround — the same trick @testing-library/react's fireEvent uses internally.
function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("JoinChapter", () => {
  it("fires client-side required-field validation before any submission round trip", async () => {
    stubFetch(null, [
      ["GET /api/chapters/invite/", { status: 200, body: { isValid: true, chapterId: 1, chapterName: "Brgy. San Isidro Chapter" } }],
    ]);
    await renderAt("/j/some-invite-token", "/j/:token", <JoinChapter />);
    await settle();

    const mobileNo = container.querySelector("#mobileNo") as HTMLInputElement;
    await act(async () => { setInputValue(mobileNo, "09171234567"); });

    // First name, gift name, birthdate, seconder are all still blank.
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain(
      "First name, last name, gift name, birthdate and a seconder's name are required.",
    );
  });

  it("shows a plain message for an invalid or superseded join link, with no picker fallback", async () => {
    stubFetch(null, [
      ["GET /api/chapters/invite/", { status: 200, body: { isValid: false, chapterId: null, chapterName: null } }],
    ]);
    await renderAt("/j/some-invite-token", "/j/:token", <JoinChapter />);
    await settle();

    expect(container.textContent).toContain("This join link isn't valid");
    // No fallback to a generic picker — that path was removed deliberately.
    expect(container.querySelector('a[href="/apply"]')).toBeNull();
  });
});

describe("ApplyStatus", () => {
  it("renders the identical generic message for a 404, regardless of which field was wrong", async () => {
    stubFetch(null, [["GET /api/membership-applications/status", { status: 404, body: {} }]]);
    await renderAt("/apply/status", "/apply/status", <ApplyStatus />);

    const referenceNo = container.querySelector("#referenceNo") as HTMLInputElement;
    const mobileNo = container.querySelector("#mobileNo") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    // A wrong reference number, correct mobile — still just a 404 from the client's view.
    await act(async () => { setInputValue(referenceNo, "APP-2026-99999"); });
    await act(async () => { setInputValue(mobileNo, "09171234567"); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    const messageAfterWrongReference = container.textContent ?? "";
    expect(messageAfterWrongReference).toContain(
      "We couldn't find that — check your reference number and mobile number.",
    );
    expect(messageAfterWrongReference).not.toMatch(/reference number is (wrong|incorrect)/i);
    expect(messageAfterWrongReference).not.toMatch(/mobile number is (wrong|incorrect)/i);

    // A correct reference number, wrong mobile — the client renders THE SAME message,
    // never inventing a distinction the server itself does not make.
    await act(async () => { setInputValue(referenceNo, "APP-2026-00001"); });
    await act(async () => { setInputValue(mobileNo, "09000000000"); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain(
      "We couldn't find that — check your reference number and mobile number.",
    );
  });
});

const PENDING_APPLICATION: ApplicationDetailModel = {
  applicationId: 1, referenceNo: "APP-2026-00001", chapterId: 1,
  firstName: "Michael", middleName: "D", lastName: "Santos", giftName: "SIGLAHI",
  birthDate: "1998-04-12", mobileNo: "09209876543", email: "michael.santos@example.com",
  dateSurvive: "2024-11-09", presidentDuringSurvive: "Ramon Delgado", masterInitiatorDuringSurvive: "Arnel Bautista",
  seconderNameGiven: "TANGLAW", seconderMemberNumberGiven: "AKR-04-0117-001",
  seconderMemberId: null, seconderResolvedGiftName: null, seconderResolvedMemberNumber: null,
  statusName: "PendingApproval", submittedDateUtc: "2026-09-13T12:01:50Z",
  decidedBy: null, decidedDateUtc: null, decisionReason: null, createdMemberId: null,
  history: [{ membershipApplicationUpdateId: 1, updateDateUtc: "2026-09-13T12:01:50Z", updatedBy: null,
    statusName: "PendingApproval", notes: "Submitted." }],
  priorApplications: [],
};

describe("ApplicationQueue and ApplicationDetail — role gating", () => {
  it("a ChapterAdmin sees the queue", async () => {
    stubFetch(["ChapterAdmin"], [
      ["GET /api/membership-applications?", { status: 200, body: { items: [{
        applicationId: 1, referenceNo: "APP-2026-00001", firstName: "Michael", middleName: "D",
        lastName: "Santos", giftName: "SIGLAHI", mobileNo: "09209876543", email: "michael.santos@example.com",
        statusName: "PendingApproval", submittedDateUtc: "2026-09-13T12:01:50Z", decidedBy: null, decidedDateUtc: null,
      }], total: 1, skip: 0, take: 25 } }],
    ]);

    await renderAt("/applications", "/applications", <ApplicationQueue />);
    expect(container.textContent).toContain("SIGLAHI");
  });

  it("a ChapterAdmin sees the three decision actions on an open application", async () => {
    stubFetch(["ChapterAdmin"], [
      ["GET /api/membership-applications/1", { status: 200, body: PENDING_APPLICATION }],
    ]);

    await renderAt("/applications/1", "/applications/:applicationId", <ApplicationDetail />);
    expect(container.textContent).toContain("Approve");
    expect(container.textContent).toContain("Return for correction");
    expect(container.textContent).toContain("Reject");
  });

  it("a plain Member gets a plain access-denied state on direct navigation, not a crash", async () => {
    stubFetch(["Member"], [
      ["GET /api/membership-applications/1", { status: 200, body: PENDING_APPLICATION }],
    ]);
    await renderAt("/applications/1", "/applications/:applicationId", <ApplicationDetail />);

    expect(container.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("Approve");
  });
});

describe("the seconder's confirmation state is never overstated", () => {
  it("renders the literal words 'Not yet confirmed' when seconderMemberId is null", async () => {
    stubFetch(["ChapterAdmin"], [
      ["GET /api/membership-applications/1", { status: 200, body: PENDING_APPLICATION }],
    ]);
    await renderAt("/applications/1", "/applications/:applicationId", <ApplicationDetail />);

    expect(container.textContent).toContain("Not yet confirmed");
  });
});

describe("the show-once enrolment link panel", () => {
  it("renders the link and makes plain that it will not be shown again", async () => {
    const approveResponse: ApproveMembershipApplicationResponse = {
      memberId: 8, memberNumber: "AKR-04-0117-007",
      enrolmentUrl: "https://ais.example.org/enrol/rawtoken123", expiresOnUtc: "2026-09-16T00:00:00Z",
    };

    stubFetch(["ChapterAdmin"], [
      ["GET /api/membership-applications/1", { status: 200, body: PENDING_APPLICATION }],
      ["POST /api/membership-applications/1/approve", { status: 200, body: approveResponse }],
    ]);
    await renderAt("/applications/1", "/applications/:applicationId", <ApplicationDetail />);

    const approveButton = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Approve") as HTMLButtonElement;
    await act(async () => { approveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();

    const confirmButton = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Yes, approve")) as HTMLButtonElement;
    await act(async () => { confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();

    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("https://ais.example.org/enrol/rawtoken123");
    expect(text).toContain("this is the only time it will ever be shown");
    expect(text).toContain("cannot be recovered here");
  });
});
