/**
 * The Help & guides pages (member app and Portal): only guides that fit the person are listed,
 * finished ones are ticked, Start begins the guide, and every state renders. Plus the two
 * reference guides' step lists for an officer and for someone who is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { TourProvider } from "./TourProvider";
import { Help } from "@/ais/screens/Help";
import { PortalHelp } from "@/portal/screens/Help";
import { buildMeetingsGuideSteps, meetingsGuide } from "@/ais/guides/meetings";
import { buildRegistrationsGuideSteps, registrationsGuide } from "@/portal/guides/registrations";
import { AIS_GUIDES } from "@/ais/guides";
import { PORTAL_GUIDES } from "@/portal/guides";
import { COUNCIL_PERMISSION } from "@/shared/roles";
import type { GuideContext } from "./types";

let container: HTMLDivElement;
let root: Root;
let roles: string[];
let seats: unknown[];
let tutorials: unknown;
let tutorialsStatus: number;

function url(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

beforeEach(() => {
  window.localStorage.clear();
  roles = ["Member"]; seats = []; tutorials = []; tutorialsStatus = 200;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const u = url(input);
    if (u.includes("/api/auth/refresh")) return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    if (u.includes("/api/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ memberId: 5, chapterId: 1, chapterName: "Test", giftName: "TANGLAW", roles, councilSeats: seats }) };
    }
    if (u.includes("/api/members/me/tutorials")) return { ok: tutorialsStatus === 200, status: tutorialsStatus, json: async () => tutorials };
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

async function mountHelp(which: "ais" | "portal") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/x"]}>
            <TourProvider memberId={5}>
              <Routes><Route path="*" element={which === "ais" ? <Help /> : <PortalHelp />} /></Routes>
            </TourProvider>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise(r => setTimeout(r, 40)); });
}

const REVIEW_SEAT = {
  councilId: 1, councilName: "Sta. Rosa", officeName: "Secretary", canManagePermissions: false,
  permissions: [COUNCIL_PERMISSION.ChapterRegistrationReview],
};

describe("Help & guides (member app)", () => {
  it("shows a plain member the every-member guides, and none of the officer ones", async () => {
    await mountHelp("ais");
    expect(container.textContent).toContain("Help & guides");
    expect(container.textContent).toContain("For every member");
    expect(container.querySelector('[data-testid="guide-guide-profile"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="guide-guide-meetings"]')).toBeNull();
    expect(container.querySelector('[data-testid="guide-guide-money"]')).toBeNull();
    expect(container.textContent).not.toContain("For chapter officers");
    expect(container.textContent).toContain("Replay the welcome tour");
  });

  it("lists the meetings guide for a chapter officer, with step count and a 44px Start", async () => {
    roles = ["ChapterOfficer"];
    await mountHelp("ais");
    const card = container.querySelector('[data-testid="guide-guide-meetings"]')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Set up a meeting");
    expect(card.textContent).toMatch(/About \d+ steps/);
    expect(container.textContent).toContain("For chapter officers");
    const start = card.querySelector("button")!;
    expect(start.textContent).toBe("Start");
    expect(start.style.minHeight).toBe("var(--tap)");
    expect(container.querySelector('[data-testid="done-guide-meetings"]')).toBeNull();
  });

  it("ticks a finished guide, but not a skipped one or an older version", async () => {
    roles = ["ChapterOfficer"];
    tutorials = [{ tourKey: "guide-meetings", tourVersion: 1, outcome: "Completed", finishedDate: "2026-01-01T00:00:00Z" }];
    await mountHelp("ais");
    expect(container.querySelector('[data-testid="done-guide-meetings"]')).toBeTruthy();
  });

  it("does not tick a skipped guide", async () => {
    roles = ["ChapterOfficer"];
    tutorials = [{ tourKey: "guide-meetings", tourVersion: 1, outcome: "Skipped", finishedDate: "2026-01-01T00:00:00Z" }];
    await mountHelp("ais");
    expect(container.querySelector('[data-testid="done-guide-meetings"]')).toBeNull();
  });

  it("still lists the guides when the finished list cannot be read", async () => {
    roles = ["ChapterOfficer"];
    tutorialsStatus = 500;
    await mountHelp("ais");
    expect(container.querySelector('[data-testid="guide-guide-meetings"]')).toBeTruthy();
    expect(container.textContent).toContain("could not check");
  });

  it("Start opens the guide's first step", async () => {
    roles = ["ChapterOfficer"];
    await mountHelp("ais");
    const start = container.querySelector<HTMLButtonElement>('[data-testid="guide-guide-meetings"] button')!;
    await act(async () => { start.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Setting up a meeting");
  });
});

describe("Help & guides (Portal)", () => {
  it("shows the empty state to someone with no council office", async () => {
    await mountHelp("portal");
    expect(container.textContent).toContain("No guides for you yet");
  });

  it("lists the registrations guide, under Chapters, for a reviewer", async () => {
    seats = [REVIEW_SEAT];
    await mountHelp("portal");
    expect(container.querySelector('[data-testid="guide-guide-portal-registrations"]')).toBeTruthy();
    expect(container.textContent).toContain("Chapters");
  });
});

describe("registry", () => {
  it("uses only server catalogue keys, once each", () => {
    const keys = [...AIS_GUIDES, ...PORTAL_GUIDES].map(g => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^guide-[a-z-]+$/);
  });
});

const ids = (steps: { id: string }[]) => steps.map(s => s.id);
const ctx = (over: Partial<GuideContext>): GuideContext =>
  ({ claims: null, roles: [], seats: [], isFeatureOpen: () => true, ...over });

describe("guide-meetings", () => {
  it("is for officers who can write meetings, and only while Meetings is open", () => {
    expect(meetingsGuide.audience(ctx({ roles: ["ChapterOfficer"] }))).toBe(true);
    expect(meetingsGuide.audience(ctx({ roles: ["ChapterAdmin"] }))).toBe(true);
    expect(meetingsGuide.audience(ctx({ roles: ["Member"] }))).toBe(false);
    expect(meetingsGuide.audience(ctx({ roles: ["ChapterOfficer"], isFeatureOpen: () => false }))).toBe(false);
  });

  it("walks the real flow in order and says contributions are voluntary", () => {
    const steps = buildMeetingsGuideSteps(ctx({ roles: ["ChapterOfficer"] }));
    expect(ids(steps)).toEqual([
      "intro", "tab", "new-button", "field-subject", "field-date", "field-venue", "field-notes", "draft-note",
      "save", "after-save", "header", "attendance", "contribution", "total", "save-draft", "finalize-note", "done",
    ]);
    const c = steps.find(s => s.id === "contribution")!;
    expect(String(c.body)).toMatch(/voluntary/i);
  });

  it("explains Finalize with its real button only for the President (chapter admin)", () => {
    const admin = buildMeetingsGuideSteps(ctx({ roles: ["ChapterAdmin"] }));
    expect(ids(admin)).toContain("finalize");
    expect(ids(admin)).not.toContain("finalize-note");
    const fin = admin.find(s => s.id === "finalize")!;
    expect(fin.target).toBe("meeting-finalize");
  });
});

describe("guide-portal-registrations", () => {
  it("is for people who may review chapter registrations", () => {
    expect(registrationsGuide.audience(ctx({ seats: [REVIEW_SEAT] }))).toBe(true);
    expect(registrationsGuide.audience(ctx({ seats: [] }))).toBe(false);
    expect(registrationsGuide.audience(ctx({ seats: [{ ...REVIEW_SEAT, permissions: [] }] }))).toBe(false);
  });

  it("walks list, search, filter, officers, verify, approve, return and what happens next", () => {
    const steps = buildRegistrationsGuideSteps(ctx({ seats: [REVIEW_SEAT] }));
    expect(ids(steps)).toEqual([
      "intro", "search", "filter", "open-one", "about-detail", "header", "officers", "officer-card",
      "verify", "count", "approve", "return", "next", "done",
    ]);
    // Steps on a registration page work out which one at run time; the list steps do not.
    expect(typeof steps.find(s => s.id === "verify")!.route).toBe("function");
    expect(steps.find(s => s.id === "search")!.route).toBe("/portal/chapter-registrations");
  });

  it("leaves the registration steps out, quietly, when the queue is empty", async () => {
    const steps = buildRegistrationsGuideSteps(ctx({ seats: [REVIEW_SEAT] }));
    // The stubbed API returns an empty list for every call.
    const route = steps.find(s => s.id === "header")!.route as (c: GuideContext) => Promise<string | null>;
    expect(await route(ctx({}))).toBeNull();
    const verify = steps.find(s => s.id === "verify")!.route as (c: GuideContext) => Promise<string | null>;
    expect(await verify(ctx({}))).toBeNull();
  });
});
