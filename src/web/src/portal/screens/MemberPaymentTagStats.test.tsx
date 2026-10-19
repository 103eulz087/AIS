/**
 * Phone fit: on a narrow screen the per-chapter report becomes stacked cards (no <table>),
 * with the same counts; on a wide screen it stays a table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { MemberPaymentTagStats, buildReportCsv } from "./MemberPaymentTagStats";
import type { CouncilSeatPermissions, MemberPaymentTagStats as StatsRow } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

const place = (regionName: string | null, provinceName: string | null, cityName: string | null) => ({ regionName, provinceName, cityName });
const STATS: StatsRow[] = [
  { chapterId: 1, chapterName: "Sta. Rosa Chapter", membershipYear: 2026, ...place("Region 4A Council", "Laguna Council", "Sta. Rosa City Council"), totalMembers: 10, paidCount: 6, freeCount: 2, unpaidCount: 2 },
  { chapterId: 2, chapterName: "Iligan Chapter", membershipYear: 2026, ...place("Region 10 Council", "Lanao del Norte Council", "Iligan City Council"), totalMembers: 20, paidCount: 20, freeCount: 0, unpaidCount: 0 },
  { chapterId: 3, chapterName: "Tubod Chapter", membershipYear: 2026, ...place("Region 10 Council", "Lanao del Norte Council", "Tubod Municipal Council"), totalMembers: 5, paidCount: 0, freeCount: 0, unpaidCount: 5 },
  { chapterId: 4, chapterName: "Cagayan Chapter", membershipYear: 2026, ...place("Region 10 Council", "Misamis Oriental Council", "Cagayan de Oro City Council"), totalMembers: 8, paidCount: 4, freeCount: 0, unpaidCount: 4 },
];

let seatPerms: string[] = ["MemberPaymentTag.Report"];
let fetchedUrls: string[] = [];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      const councilSeats: CouncilSeatPermissions[] = [
        { councilId: 1, councilName: "National Council", officeName: "President", permissions: seatPerms, canManagePermissions: true },
      ];
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles: ["CouncilAdmin"], councilSeats }),
      };
    }
    if (url.includes("/api/member-payment-tags/stats")) {
      fetchedUrls.push(url);
      return { ok: true, status: 200, json: async () => STATS };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches, media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null,
  }));
}

async function renderScreen(path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}><MemberPaymentTagStats /></MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  seatPerms = ["MemberPaymentTag.Report"];
  fetchedUrls = [];
  stubFetch();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MemberPaymentTagStats layout", () => {
  it("shows stacked cards, not a table, on a phone", async () => {
    mockMatchMedia(true);
    await renderScreen();
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Sta. Rosa Chapter");
    expect(container.textContent).toContain("80%");
  });

  it("keeps the table on a wide screen", async () => {
    mockMatchMedia(false);
    await renderScreen();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("Sta. Rosa Chapter");
  });
});

function pick(label: string, value: string) {
  const el = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function options(label: string): string[] {
  return [...container.querySelectorAll(`select[aria-label="${label}"] option`)].map(o => o.textContent ?? "");
}
function chip(text: string) {
  return [...container.querySelectorAll("button")].find(b => b.textContent === text) as HTMLButtonElement;
}
function shown() { return container.textContent ?? ""; }

describe("MemberPaymentTagStats search and filters", () => {
  beforeEach(() => mockMatchMedia(false));

  it("shows the place under the chapter name without the word Council", async () => {
    await renderScreen();
    expect(shown()).toContain("Iligan City · Lanao del Norte · Region 10");
    expect(shown()).toContain("Showing 4 of 4 chapters");
  });

  it("search narrows rows by chapter or place, as you type", async () => {
    await renderScreen();
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "laguna");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    expect(shown()).toContain("Showing 1 of 4 chapters");
    expect(shown()).toContain("Sta. Rosa Chapter");
    expect(shown()).not.toContain("Tubod Chapter");
  });

  it("limits province and city options to the chosen region and province", async () => {
    await renderScreen();
    expect(options("Province")).toEqual(["All provinces", "Lanao del Norte", "Laguna", "Misamis Oriental"].sort((a, b) => a === "All provinces" ? -1 : b === "All provinces" ? 1 : a.localeCompare(b)));
    await pick("Region", "Region 10");
    expect(options("Province")).toEqual(["All provinces", "Lanao del Norte", "Misamis Oriental"]);
    await pick("Province", "Lanao del Norte");
    expect(options("City")).toEqual(["All cities", "Iligan City", "Tubod Municipal"]);
    expect(shown()).toContain("Showing 2 of 4 chapters");
    // Changing the region resets the province under it.
    await pick("Region", "Region 4A");
    expect((container.querySelector('select[aria-label="Province"]') as HTMLSelectElement).value).toBe("");
    expect(shown()).toContain("Showing 1 of 4 chapters");
  });

  it("Has unpaid members chip hides chapters with nobody unpaid", async () => {
    await renderScreen();
    await act(async () => { chip("Has unpaid members").click(); });
    expect(shown()).toContain("Showing 3 of 4 chapters");
    expect(shown()).not.toContain("Iligan Chapter");
  });

  it("Nobody tagged yet chip keeps only chapters with no paid or free members", async () => {
    await renderScreen();
    await act(async () => { chip("Nobody tagged yet").click(); });
    expect(shown()).toContain("Showing 1 of 4 chapters");
    expect(shown()).toContain("Tubod Chapter");
  });

  it("sorts by Most unpaid", async () => {
    await renderScreen();
    await pick("Sort by", "unpaid");
    const names = [...container.querySelectorAll("tbody tr")].map(tr => tr.textContent ?? "");
    expect(names[0]).toContain("Tubod Chapter");
    expect(names[1]).toMatch(/Cagayan|Sta\. Rosa/);
    expect(names[names.length - 1]).toContain("Iligan Chapter");
  });

  it("summary tiles reflect the filtered rows", async () => {
    await renderScreen();
    await pick("Region", "Region 10");
    // 20+5+8 members, 24 paid, 9 unpaid, 24/33 = 73%
    expect(shown()).toContain("33");
    expect(shown()).toContain("73%");
    expect(shown()).not.toContain("Sta. Rosa Chapter");
  });

  it("shows a clear empty state when nothing matches, and Clear brings everything back", async () => {
    await renderScreen("/?region=Region%2010&show=settled&q=tubod");
    expect(shown()).toContain("No chapter matches these filters");
    await act(async () => { chip("Clear filters").click(); });
    expect(shown()).toContain("Showing 4 of 4 chapters");
  });

  it("refetches for a chosen membership year", async () => {
    await renderScreen();
    const yearOptions = options("Membership year");
    expect(yearOptions.length).toBeGreaterThan(0);
    await renderScreen("/?year=2026");
    expect(fetchedUrls.some(u => u.includes("membershipYear=2026"))).toBe(true);
  });

  it("tells a caller with only the old Read key that they have no access", async () => {
    seatPerms = ["MemberPaymentTag.Read"];
    await renderScreen();
    expect(shown()).toContain("You don't have access to this");
    expect(shown()).toContain("View payment report");
    expect(fetchedUrls.length).toBe(0);
  });
});

describe("buildReportCsv", () => {
  it("starts with a BOM and the header, quotes awkward fields, and leaves missing places blank", () => {
    const csv = buildReportCsv([
      { ...STATS[0]!, chapterName: 'Doña "Ñ", Chapter', regionName: null, provinceName: null, cityName: null },
      STATS[1]!,
    ]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Chapter,Region,Province,City,Members,Paid,Free,Unpaid,% paid or free,Membership year");
    expect(lines[1]).toBe('"Doña ""Ñ"", Chapter",,,,10,6,2,2,80%,2026');
    expect(lines[2]).toBe("Iligan Chapter,Region 10,Lanao del Norte,Iligan City,20,20,0,0,100%,2026");
  });
});

describe("MemberPaymentTagStats links and phone filters", () => {
  it("accepts a place in the link written with or without 'Council', in any case", async () => {
    mockMatchMedia(false);
    await renderScreen("/?region=region%2010%20council&province=Lanao%20del%20Norte%20Council");
    expect((container.querySelector('select[aria-label="Region"]') as HTMLSelectElement).value).toBe("Region 10");
    expect((container.querySelector('select[aria-label="Province"]') as HTMLSelectElement).value).toBe("Lanao del Norte");
    expect(shown()).toContain("Showing 2 of 4 chapters");
  });

  it("ignores a place in the link that matches no chapter instead of showing nothing", async () => {
    mockMatchMedia(false);
    await renderScreen("/?region=Atlantis");
    expect((container.querySelector('select[aria-label="Region"]') as HTMLSelectElement).value).toBe("");
    expect(shown()).toContain("Showing 4 of 4 chapters");
  });

  it("folds the place, year and sort controls behind a button on a phone, keeping search visible", async () => {
    mockMatchMedia(true);
    await renderScreen("/?region=Region%2010");
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Region"]')).toBeNull();
    const toggle = [...container.querySelectorAll("button")].find(b => b.textContent?.startsWith("Filters & sort"))!;
    expect(toggle.textContent).toContain("(1 in use)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(container.querySelector('select[aria-label="Region"]')).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(shown()).toContain("Showing 3 of 4 chapters");
  });
});
