/**
 * PortalShell nav visibility (client decision 2026-10-06): a user seated ONLY as
 * CouncilSecretary — nowhere also CouncilAdmin — sees just the "Chapter registrations"
 * link; every other Portal menu is hidden from the nav entirely. A CouncilAdmin (and
 * anyone who holds CouncilAdmin alongside CouncilSecretary) still sees the full nav.
 *
 * Phase 1 "dynamic council office permissions" (2026-10-17): "Chapter registrations",
 * "Statistics" and "Members" are now gated on claims.councilSeats' own permission keys,
 * not role name — seatsForRoles() below reproduces db/schema/28_council_permissions.sql's
 * own CouncilPermissionDefault grant exactly (President/Secretary get all six keys,
 * Treasurer/Vice President/PIO get CouncilMemberSearch.Read only, Auditor gets nothing),
 * so these tests exercise the SAME nav visibility phase 1 ships with by default — the one
 * difference the real grid does not change until a council's own President edits it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { PortalShell } from "./PortalShell";
import type { CouncilSeatPermissions } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

const ALL_SIX = [
  "ChapterRegistration.Review", "ChapterRegistration.Verify", "ChapterRegistration.Approve",
  "ChapterRegistration.Return", "CouncilStatistics.Read", "CouncilMemberSearch.Read",
];

/** Mirrors db/schema/28_council_permissions.sql's own CouncilPermissionDefault seed, one
 * seat per role (a real member seats one office per council; this is test convenience
 * only, never a shape the real API would send for more than one role at once). */
function seatsForRoles(roles: string[]): CouncilSeatPermissions[] {
  const byRole: Record<string, { officeName: string; permissions: string[]; canManagePermissions: boolean }> = {
    CouncilAdmin: { officeName: "President", permissions: ALL_SIX, canManagePermissions: true },
    CouncilSecretary: { officeName: "Secretary", permissions: ALL_SIX, canManagePermissions: false },
    CouncilTreasurer: { officeName: "Treasurer", permissions: ["CouncilMemberSearch.Read"], canManagePermissions: false },
    CouncilOfficer: { officeName: "Vice President", permissions: ["CouncilMemberSearch.Read"], canManagePermissions: false },
    CouncilPIO: { officeName: "Public Information Officer", permissions: ["CouncilMemberSearch.Read"], canManagePermissions: false },
    CouncilAuditor: { officeName: "Auditor", permissions: [], canManagePermissions: false },
  };
  const seats: CouncilSeatPermissions[] = [];
  for (const r of roles) {
    const def = byRole[r];
    if (!def) continue;
    seats.push({ councilId: seats.length + 1, councilName: "Sta. Rosa City Council", ...def });
  }
  return seats;
}

function nationalSeat(officeName: string, permissions: string[], canManagePermissions: boolean): CouncilSeatPermissions {
  return { councilId: 1, councilName: "National Council", officeName, permissions, canManagePermissions };
}

function stubAuthFetch(roles: string[], seatsOverride?: CouncilSeatPermissions[]) {
  const councilSeats = seatsOverride ?? seatsForRoles(roles);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles, councilSeats }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/portal/chapter-registrations"]}>
            <PortalShell />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function navLinkTexts(): string[] {
  return Array.from(container.querySelectorAll("nav a")).map(a => a.textContent ?? "");
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

describe("PortalShell — nav visibility", () => {
  it("shows Chapter registrations, Statistics, Members and Office permissions to a Secretary-only user, but no phase 2 link", async () => {
    stubAuthFetch(["CouncilSecretary"]);
    await renderShell();

    const links = navLinkTexts();
    // Phase 1 (2026-10-17): these three now follow the Secretary office's own default
    // permission grant (db/schema/28_council_permissions.sql's CouncilPermissionDefault),
    // which already carries all six keys for Secretary, same as President — so these are
    // now VISIBLE to a Secretary-only user, a change from the old hardcoded nav rule that
    // hid Members/Statistics here regardless of what the Secretary role could actually do.
    expect(links).toContain("Chapter registrations");
    expect(links).toContain("Statistics");
    expect(links).toContain("Members");
    // Any council seat at all sees this, including a read-only Auditor.
    expect(links).toContain("Office permissions");
    // Phase 2 links stay behind the secretaryOnly narrowing, unchanged.
    expect(links).not.toContain("Councils");
    expect(links).not.toContain("Payment tags");
    expect(links).not.toContain("Payment report");
    expect(links).not.toContain("Announcements");
    expect(links).not.toContain("ID card export");
    expect(links).not.toContain("Chapter holds");
  });

  it("shows the full nav to a CouncilAdmin", async () => {
    stubAuthFetch(["CouncilAdmin"]);
    await renderShell();

    const links = navLinkTexts();
    expect(links).toContain("Chapter registrations");
    expect(links).toContain("Statistics");
    expect(links).toContain("Councils");
    expect(links).toContain("Members");
    expect(links).toContain("Office permissions");
  });

  it("shows Payment tags and Payment report to a National President seat holding the payment tag keys", async () => {
    stubAuthFetch(["CouncilAdmin"], [
      nationalSeat("President", [...ALL_SIX, "MemberPaymentTag.Read", "MemberPaymentTag.Set", "MemberPaymentTag.Report"], true),
    ]);
    await renderShell();

    const links = navLinkTexts();
    expect(links).toContain("Payment tags");
    expect(links).toContain("Payment report");
  });

  it("shows Payment report only with the Report key, and Payment tags only with the Read key", async () => {
    stubAuthFetch(["CouncilAdmin"], [nationalSeat("President", [...ALL_SIX, "MemberPaymentTag.Report"], true)]);
    await renderShell();
    const links = navLinkTexts();
    expect(links).toContain("Payment report");
    expect(links).not.toContain("Payment tags");
  });

  it("hides Payment report when the seat has only the Read key", async () => {
    stubAuthFetch(["CouncilAdmin"], [nationalSeat("President", [...ALL_SIX, "MemberPaymentTag.Read"], true)]);
    await renderShell();
    const links = navLinkTexts();
    expect(links).toContain("Payment tags");
    expect(links).not.toContain("Payment report");
  });

  it("hides Payment tags and Payment report from a National Secretary-only seat without the keys", async () => {
    stubAuthFetch(["CouncilSecretary"], [nationalSeat("Secretary", ALL_SIX, false)]);
    await renderShell();

    const links = navLinkTexts();
    expect(links).not.toContain("Payment tags");
    expect(links).not.toContain("Payment report");
  });

  it("hides Payment tags from a President seat on a non-National council (default grant has no payment keys)", async () => {
    stubAuthFetch(["CouncilAdmin"]);
    await renderShell();

    const links = navLinkTexts();
    expect(links).not.toContain("Payment tags");
    expect(links).not.toContain("Payment report");
  });

  it("hides Chapter registrations, Statistics and Members from a role with none of those permissions (Treasurer)", async () => {
    stubAuthFetch(["CouncilTreasurer"]);
    await renderShell();

    const links = navLinkTexts();
    expect(links).not.toContain("Chapter registrations");
    expect(links).not.toContain("Statistics");
    // Treasurer's default grant is CouncilMemberSearch.Read only.
    expect(links).toContain("Members");
    expect(links).toContain("Office permissions");
  });

  it("shows the full nav to a member who is CouncilSecretary at one council AND CouncilAdmin at another", async () => {
    stubAuthFetch(["CouncilSecretary", "CouncilAdmin"]);
    await renderShell();

    const links = navLinkTexts();
    expect(links).toContain("Councils");
  });

  it("drops a whole group, heading included, when none of its links are visible", async () => {
    stubAuthFetch(["CouncilSecretary"]);
    await renderShell();

    const headings = Array.from(container.querySelectorAll("nav h2")).map(h => h.textContent);
    // Secretary-only keeps Chapter registrations, Members, Statistics and Office permissions.
    expect(headings).toEqual(["Chapters", "Members", "Councils"]);
    expect(headings).not.toContain("Notices");
    const councils = container.querySelector('section[aria-label="Councils"]')!;
    expect(Array.from(councils.querySelectorAll("a")).map(a => a.textContent))
      .toEqual(["Office permissions", "Statistics"]);
  });

  it("keeps a group while any link in it is visible (Treasurer: Chapters holds only, no registrations)", async () => {
    stubAuthFetch(["CouncilTreasurer"]);
    await renderShell();

    // Treasurer is not secretaryOnly, so phase 2 links (incl. Chapter holds) still show.
    const chapters = container.querySelector('section[aria-label="Chapters"]')!;
    expect(Array.from(chapters.querySelectorAll("a")).map(a => a.textContent)).toEqual(["Chapter holds"]);
  });

  it("shows all four groups to a CouncilAdmin and marks only the current link active", async () => {
    stubAuthFetch(["CouncilAdmin"]);
    await renderShell();

    const headings = Array.from(container.querySelectorAll("nav h2")).map(h => h.textContent);
    expect(headings).toEqual(["Chapters", "Members", "Councils", "Notices"]);
    const active = Array.from(container.querySelectorAll("nav a.active")).map(a => a.textContent);
    expect(active).toEqual(["Chapter registrations"]);
  });

  it("shows the Settings group with App settings only to a seat holding AppSettings.Manage", async () => {
    stubAuthFetch([], [nationalSeat("President", [...ALL_SIX, "AppSettings.Manage"], true)]);
    await renderShell();
    const headings = Array.from(container.querySelectorAll("nav h2")).map(h => h.textContent);
    expect(headings[headings.length - 1]).toBe("Settings");
    const settings = container.querySelector('section[aria-label="Settings"]')!;
    expect(Array.from(settings.querySelectorAll("a")).map(a => a.textContent)).toEqual(["App settings"]);
  });

  it("hides the Settings group entirely without AppSettings.Manage", async () => {
    stubAuthFetch(["CouncilAdmin"]);
    await renderShell();
    expect(navLinkTexts()).not.toContain("App settings");
    expect(container.querySelector('section[aria-label="Settings"]')).toBeNull();
  });
});

describe("PortalShell — hamburger menu", () => {
  it("toggles aria-expanded on the hamburger, and the close button shuts the drawer", async () => {
    stubAuthFetch(["CouncilAdmin"]);
    await renderShell();
    const burger = container.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]')!;
    expect(burger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { burger.click(); });
    expect(burger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".pshell-side")!.classList.contains("is-open")).toBe(true);
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close menu"]')!;
    await act(async () => { close.click(); });
    expect(burger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".pshell-side")!.classList.contains("is-open")).toBe(false);
  });

  it("folds and unfolds a group's links from its heading on a narrow screen", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {},
    }));
    stubAuthFetch(["CouncilAdmin"]);
    await renderShell();
    const heading = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button.pshell-hbtn")).find(b => b.textContent === label)!;
    const hidden = (id: string) => container.querySelector<HTMLElement>("#" + id)!.hidden;
    // The page is Chapter registrations, so Chapters starts open and Members starts folded.
    expect(heading("Chapters").getAttribute("aria-expanded")).toBe("true");
    expect(heading("Members").getAttribute("aria-expanded")).toBe("false");
    await act(async () => { heading("Chapters").click(); });
    expect(hidden("pnav-chapters")).toBe(true);
    await act(async () => { heading("Members").click(); });
    expect(hidden("pnav-members")).toBe(false);
    // Links stay in the DOM either way.
    expect(navLinkTexts()).toContain("Chapter registrations");
  });
});
