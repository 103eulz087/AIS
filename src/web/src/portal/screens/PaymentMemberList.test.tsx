/** The member list behind the Payment report's tiles and chapter rows. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { MemberPaymentTagStats } from "./MemberPaymentTagStats";
import { buildMembersCsv, type PaymentReportMember } from "./PaymentMemberList";
import type { CouncilSeatPermissions, MemberPaymentTagStats as StatsRow } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

const place = (r: string, p: string, c: string) => ({ regionName: r, provinceName: p, cityName: c });
const STATS: StatsRow[] = [
  { chapterId: 1, chapterName: "Sta. Rosa Chapter", membershipYear: 2026, ...place("Region 4A Council", "Laguna Council", "Sta. Rosa City Council"), totalMembers: 10, paidCount: 6, freeCount: 2, unpaidCount: 2 },
  { chapterId: 2, chapterName: "Iligan Chapter", membershipYear: 2026, ...place("Region 10 Council", "Lanao del Norte Council", "Iligan City Council"), totalMembers: 20, paidCount: 20, freeCount: 0, unpaidCount: 0 },
  { chapterId: 3, chapterName: "Tubod Chapter", membershipYear: 2026, ...place("Region 10 Council", "Lanao del Norte Council", "Tubod Municipal Council"), totalMembers: 5, paidCount: 0, freeCount: 0, unpaidCount: 5 },
];

const member = (id: number, st: "Paid" | "Free" | "Unpaid", date: string | null): PaymentReportMember => ({
  memberId: id, memberNumber: `AKR-01-0001-00${id}`, giftName: `GIFT${id}`, fullName: `Juan ${id}, Dela Cruz`,
  chapterId: 2, chapterName: "Iligan Chapter", regionName: "Region 10 Council", provinceName: "Lanao del Norte Council",
  cityName: "Iligan City Council", paymentStatus: st, taggedDateUtc: date, taggedByGiftName: date ? "TANGLAW" : null, membershipYear: 2026,
});

let seatPerms: string[] = [];
let memberUrls: string[] = [];
let total = 2;
let pageItems: PaymentReportMember[] = [];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    if (url.includes("/api/auth/me")) {
      const councilSeats: CouncilSeatPermissions[] = [
        { councilId: 1, councilName: "National Council", officeName: "President", permissions: seatPerms, canManagePermissions: true },
      ];
      return { ok: true, status: 200, json: async () => ({ memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles: ["CouncilAdmin"], councilSeats }) };
    }
    if (url.includes("/api/member-payment-tags/report-members")) {
      memberUrls.push(url);
      const skip = Number(new URL(url, "http://x").searchParams.get("skip"));
      return { ok: true, status: 200, json: async () => ({ items: skip === 0 ? pageItems : [member(99, "Paid", "2026-10-01T02:00:00Z")], total }) };
    }
    if (url.includes("/api/member-payment-tags/stats")) return { ok: true, status: 200, json: async () => STATS };
    return { ok: true, status: 200, json: async () => ({}) };
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
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 60)); });
function btn(text: string) {
  return [...container.querySelectorAll("button")].find(b => b.textContent === text) as HTMLButtonElement;
}
function tile(label: string) {
  return container.querySelector(`button[aria-label^="${label}:"]`) as HTMLButtonElement;
}
async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); await settle(); }
const params = (u: string | undefined) => new URL(u ?? "", "http://x").searchParams;
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  seatPerms = ["MemberPaymentTag.Report", "MemberPaymentTag.Read"];
  memberUrls = [];
  total = 2;
  pageItems = [member(1, "Paid", "2026-10-19T02:00:00Z"), member(2, "Unpaid", null)];
  stubFetch();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Payment report member list", () => {
  it("Paid tile opens the list with status=Paid and no chapterIds when unfiltered", async () => {
    await renderScreen();
    await click(tile("Paid"));
    expect(memberUrls).toHaveLength(1);
    const p = params(memberUrls[0]);
    expect(p.get("status")).toBe("Paid");
    expect(p.get("chapterIds")).toBeNull();
    expect(p.get("membershipYear")).toBe("2026");
    expect(p.get("take")).toBe("50");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(text()).toContain("Paid members · All chapters · 2026–27");
    expect(text()).toContain("2 members");
  });

  it("sends the chapters shown when a place filter is active", async () => {
    await renderScreen("/?region=Region%2010");
    await click(tile("Unpaid"));
    const p = params(memberUrls[0]);
    expect(p.get("status")).toBe("Unpaid");
    expect(p.get("chapterIds")).toBe("2,3");
    expect(text()).toContain("Region 10");
  });

  it("Total members sends no status; chips switch status without closing", async () => {
    await renderScreen();
    await click(tile("Total members"));
    expect(params(memberUrls[0]).get("status")).toBeNull();
    await click(btn("Free"));
    expect(params(memberUrls[1]).get("status")).toBe("Free");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("shows the date paid, who recorded it, and a dash for Unpaid", async () => {
    await renderScreen();
    await click(tile("Total members"));
    expect(text()).toContain("Paid on Oct 19, 2026");
    expect(text()).toContain("by TANGLAW");
    const rows = [...container.querySelectorAll('[role="dialog"] tbody tr')];
    expect(rows[1]?.textContent).toContain("—");
    expect(rows[1]?.textContent).not.toContain("Paid on");
  });

  it("Show more appends the next page", async () => {
    total = 3;
    await renderScreen();
    await click(tile("Total members"));
    await click(btn("Show more (1 left)"));
    expect(params(memberUrls[1]).get("skip")).toBe("2");
    expect(text()).toContain("GIFT99");
    expect(text()).toContain("GIFT1");
    expect(btn("Show more (0 left)")).toBeUndefined();
  });

  it("without the View payment tags permission shows a note and makes no request", async () => {
    seatPerms = ["MemberPaymentTag.Report"];
    await renderScreen();
    await click(tile("Paid"));
    expect(memberUrls).toHaveLength(0);
    expect(text()).toContain("needs the 'View payment tags' permission");
  });

  it("a chapter row opens the list for just that chapter, all statuses", async () => {
    await renderScreen();
    const row = [...container.querySelectorAll("tbody tr")].find(r => r.textContent?.includes("Tubod Chapter"))!;
    await click(row);
    const p = params(memberUrls[0]);
    expect(p.get("chapterIds")).toBe("3");
    expect(p.get("status")).toBeNull();
    expect(text()).toContain("All members · Tubod Chapter");
  });

  it("Escape closes the panel", async () => {
    await renderScreen();
    await click(tile("Paid"));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("builds the members CSV with BOM, Manila date and quoting", () => {
    const csv = buildMembersCsv([member(1, "Paid", "2026-10-19T17:00:00Z"), member(2, "Unpaid", null)]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Gift name,Full name,Member number,Chapter,Region,Province,City,Status,Date paid or free,Recorded by,Membership year");
    expect(lines[1]).toBe('GIFT1,"Juan 1, Dela Cruz",AKR-01-0001-001,Iligan Chapter,Region 10,Lanao del Norte,Iligan City,Paid,2026-10-20,TANGLAW,2026');
    expect(lines[2]).toContain(",Unpaid,,,2026");
  });
});
