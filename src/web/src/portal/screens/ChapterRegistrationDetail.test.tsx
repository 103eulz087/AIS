/**
 * Council review of a chapter registration (§7A.4). Covers: the Approve action is
 * absent/disabled until every officer is verified; there is NO reject button/control
 * anywhere on the screen, ever (asserted by absence, not skipped); and — since the
 * original decision E1b two-person control was widened 2026-10-06 — a CouncilSecretary
 * sees and can trigger Approve exactly like a CouncilAdmin once all 8 officers are
 * verified, not merely Verify.
 *
 * Phase 1 "dynamic council office permissions" (2026-10-17): the whole-screen gate
 * (canReviewChapterRegistrations) now reads claims.councilSeats' own ChapterRegistration.
 * Review key, not role name — stubFetch below grants it (and the other five phase 1 keys)
 * to CouncilAdmin/CouncilSecretary the same way db/schema/28_council_permissions.sql's own
 * default grant does, so every existing scenario below exercises the SAME visibility as
 * before. The three decision controls (Verify/Approve/Return) are now driven by
 * data.canVerify/canApprove/canReturn on the registration itself — a direct-seat check the
 * detail endpoint already computed against this registration's own acting council — so
 * makeRegistration() defaults all three to true (reproducing the old "Submitted means
 * decide" behaviour) and a dedicated test below shows a seat that holds the coarse Review
 * permission but NOT Approve on this particular registration gets no Approve button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { ChapterRegistrationDetail } from "./ChapterRegistrationDetail";
import type { ChapterRegistrationDetail as ChapterRegistrationDetailModel, ChapterRegistrationOfficer, CouncilSeatPermissions } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface FetchRule { status: number; body: unknown }

const REVIEW_PERMISSIONS = [
  "ChapterRegistration.Review", "ChapterRegistration.Verify", "ChapterRegistration.Approve",
  "ChapterRegistration.Return", "CouncilStatistics.Read", "CouncilMemberSearch.Read",
];

/** Mirrors db/schema/28_council_permissions.sql's own default grant for the two roles
 * that have historically reviewed chapter registrations — test convenience only. */
function councilSeatsFor(roles: string[]): CouncilSeatPermissions[] {
  if (roles.includes("CouncilAdmin")) {
    return [{ councilId: 10, councilName: "Sta. Rosa City Council", officeName: "President", canManagePermissions: true, permissions: REVIEW_PERMISSIONS }];
  }
  if (roles.includes("CouncilSecretary")) {
    return [{ councilId: 10, councilName: "Sta. Rosa City Council", officeName: "Secretary", canManagePermissions: false, permissions: REVIEW_PERMISSIONS }];
  }
  return [];
}

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
        json: async () => ({
          memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles,
          councilSeats: councilSeatsFor(roles),
        }),
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
    return { ok: true, status: 200, json: async () => ({}) };
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

function makeOfficer(officerId: number, officeName: string, verified: boolean): ChapterRegistrationOfficer {
  return {
    registrationOfficerId: officerId, officeId: officerId, officeName, sortOrder: officerId, grantsLogin: true,
    memberId: null, memberNumber: null,
    firstName: "Juan", middleName: null, lastName: "Dela Cruz", giftName: `OFFICER${officerId}`,
    birthDate: "1990-01-01", mobileNo: "09171234567", email: null, dateSurvive: null,
    presidentDuringSurvive: null, masterInitiatorDuringSurvive: null,
    verifiedBy: verified ? 5 : null, verifiedByGiftName: verified ? "SEKRETARYO" : null,
    verifiedDateUtc: verified ? "2026-09-01T00:00:00Z" : null, verifyNote: null,
    createdMemberId: null, hasAccount: false,
  };
}

function makeRegistration(
  officers: ChapterRegistrationOfficer[],
  permissions?: { canVerify?: boolean; canApprove?: boolean; canReturn?: boolean },
): ChapterRegistrationDetailModel {
  return {
    registrationId: 1, referenceNo: "CHR-2026-0001", registrationType: "Charter",
    chapterId: null, chapterName: null, proposedChapterName: "Brgy. Test Chapter",
    barangay: "Test", regionId: 4, provinceId: 41, municipalityId: 411,
    regionName: "Region IV-A CALABARZON", provinceName: "Laguna Provincial Council", municipalityName: "Sta. Rosa City",
    markAccentId: 1, accentName: "Brass", hexValue: "#C39A3E",
    intendedCouncilId: 10, intendedCouncilName: "Sta. Rosa City Council",
    actingCouncilId: 10, actingCouncilName: "Sta. Rosa City Council", routingReason: "Parent",
    submittedByMemberId: null, submittedByGiftName: null, submittedDateUtc: "2026-09-01T00:00:00Z",
    statusName: "Submitted", isOpen: true,
    decidedBy: null, decidedByGiftName: null, decidedDateUtc: null, decisionReason: null,
    createdChapterId: null,
    // Phase 1: these default to true, reproducing the pre-phase-1 "Submitted means decide"
    // behaviour every scenario below relies on — override per test to exercise a seat
    // that the detail endpoint has NOT granted one of the three on THIS registration.
    canVerify: permissions?.canVerify ?? true,
    canApprove: permissions?.canApprove ?? true,
    canReturn: permissions?.canReturn ?? true,
    officers, history: [], routing: null,
  };
}

const ALL_8_VERIFIED = makeRegistration(
  Array.from({ length: 8 }, (_, i) => makeOfficer(i + 1, `Office ${i + 1}`, true)),
);

const FIVE_OF_8_VERIFIED = makeRegistration([
  ...Array.from({ length: 5 }, (_, i) => makeOfficer(i + 1, `Office ${i + 1}`, true)),
  ...Array.from({ length: 3 }, (_, i) => makeOfficer(i + 6, `Office ${i + 6}`, false)),
]);

describe("ChapterRegistrationDetail — no reject action anywhere on this screen", () => {
  it("never renders a reject/deny control, regardless of role or verification state", async () => {
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: ALL_8_VERIFIED }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const buttonLabels = Array.from(container.querySelectorAll("button")).map(b => b.textContent ?? "");
    expect(buttonLabels.some(t => /reject/i.test(t))).toBe(false);
    expect(container.textContent ?? "").not.toMatch(/reject/i);
  });
});

describe("ChapterRegistrationDetail — Approve is gated on full verification", () => {
  it("shows Approve disabled, with a stated reason, until every officer is verified", async () => {
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: FIVE_OF_8_VERIFIED }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const approveButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Approve") as HTMLButtonElement;
    expect(approveButton).toBeTruthy();
    expect(approveButton.disabled).toBe(true);
    expect(approveButton.title).toContain("5 of 8 verified");
  });

  it("enables Approve once all 8 officers are verified, for a CouncilAdmin", async () => {
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: ALL_8_VERIFIED }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const approveButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Approve") as HTMLButtonElement;
    expect(approveButton).toBeTruthy();
    expect(approveButton.disabled).toBe(false);
  });
});

describe("ChapterRegistrationDetail — CouncilSecretary approval (widened 2026-10-06)", () => {
  it("a CouncilSecretary sees and can trigger Approve once all 8 officers are verified", async () => {
    stubFetch(["CouncilSecretary"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: ALL_8_VERIFIED }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const approveButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Approve") as HTMLButtonElement;
    expect(approveButton).toBeTruthy();
    expect(approveButton.disabled).toBe(false);
  });

  it("a CouncilSecretary sees Approve disabled, with a stated reason, until every officer is verified", async () => {
    stubFetch(["CouncilSecretary"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: FIVE_OF_8_VERIFIED }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const approveButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Approve") as HTMLButtonElement;
    expect(approveButton).toBeTruthy();
    expect(approveButton.disabled).toBe(true);
    expect(approveButton.title).toContain("5 of 8 verified");
  });

  it("a plain Member gets the review screen's own access-denied state, not the review UI", async () => {
    stubFetch(["Member"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: ALL_8_VERIFIED }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    expect(container.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("Approve");
  });
});

describe("ChapterRegistrationDetail — phase 1: decision controls follow THIS registration's own canVerify/canApprove/canReturn", () => {
  it("holding the coarse Review permission (screen access) is not enough — no Approve button when data.canApprove is false", async () => {
    const noApprove = makeRegistration(
      Array.from({ length: 8 }, (_, i) => makeOfficer(i + 1, `Office ${i + 1}`, true)),
      { canApprove: false },
    );
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: noApprove }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    // The screen itself still loads (canReviewChapterRegistrations passed) — it is only
    // the Approve BUTTON that is absent, driven by this registration's own data.canApprove.
    expect(container.textContent).not.toContain("You don't have access to this");
    const buttons = Array.from(container.querySelectorAll("button")).map(b => b.textContent ?? "");
    expect(buttons).not.toContain("Approve");
  });

  it("still offers Return with a remark when data.canReturn is true even though data.canApprove is false", async () => {
    const returnOnly = makeRegistration(
      Array.from({ length: 8 }, (_, i) => makeOfficer(i + 1, `Office ${i + 1}`, true)),
      { canApprove: false, canReturn: true },
    );
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: returnOnly }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const buttons = Array.from(container.querySelectorAll("button")).map(b => b.textContent ?? "");
    expect(buttons).not.toContain("Approve");
    expect(buttons).toContain("Return with a remark");
  });

  it("offers no Verify/Undo control on an officer row when data.canVerify is false", async () => {
    const noVerify = makeRegistration(
      Array.from({ length: 8 }, (_, i) => makeOfficer(i + 1, `Office ${i + 1}`, i < 5)),
      { canVerify: false },
    );
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: noVerify }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const buttons = Array.from(container.querySelectorAll("button")).map(b => b.textContent ?? "");
    expect(buttons).not.toContain("Verify");
    expect(buttons).not.toContain("Undo verification");
  });

  it("offers none of the three decision controls once the registration is already Approved, even with every flag true", async () => {
    const alreadyApproved = {
      ...makeRegistration(Array.from({ length: 8 }, (_, i) => makeOfficer(i + 1, `Office ${i + 1}`, true))),
      statusName: "Approved" as const, isOpen: false, decisionReason: null,
    };
    stubFetch(["CouncilAdmin"], [
      ["GET /api/chapter-registrations/1", { status: 200, body: alreadyApproved }],
    ]);
    await renderAt("/portal/chapter-registrations/1", "/portal/chapter-registrations/:registrationId", <ChapterRegistrationDetail />);

    const buttons = Array.from(container.querySelectorAll("button")).map(b => b.textContent ?? "");
    expect(buttons).not.toContain("Approve");
    expect(buttons).not.toContain("Return with a remark");
    expect(buttons).not.toContain("Verify");
  });
});
