import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CouncilMap } from "./CouncilMap";
import {
  aggregate, boxString, buildClasses, classIndex, parseViewBox, resetMapShapeCache, unplacedTotals, zoomBox,
  type MapPlace, type MapShape,
} from "./councilMapLogic";

const REGIONS = {
  viewBox: "0 0 1000 1374", attribution: "Test attribution",
  shapes: [
    { key: "R1", regionCode: "01", name: "Region One", d: "M0 0l10 0l0 10z", cx: 200, cy: 200 },
    { key: "R2", regionCode: "02", name: "Region Two", d: "M500 900l10 0l0 10z", cx: 800, cy: 1200 },
  ],
};
const PROVINCES = {
  viewBox: "0 0 1000 1374", attribution: "Test attribution",
  shapes: [
    { key: "P1", provinceCodes: [1], regionCode: "01", name: "Alpha", d: "M0 0l10 0l0 10z", cx: 180, cy: 180 },
    { key: "NCR", provinceCodes: [2, 3], regionCode: "01", name: "Metro Test", d: "M20 0l10 0l0 10z", cx: 220, cy: 220 },
    { key: "P4", provinceCodes: [4], regionCode: "02", name: "Delta", d: "M500 900l10 0l0 10z", cx: 800, cy: 1200 },
  ],
};

const place = (regionCode: string | null, provinceCode: number | null, members: number, chapters = 1, appUsers = 0): MapPlace =>
  ({ regionCode, provinceCode, members, chapters, activeChapters: chapters, appUsers });

let container: HTMLDivElement;
let root: Root;
let urls: string[];
let places: MapPlace[];

function stub() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes("/maps/ph-regions.json")) return ok(REGIONS);
    if (url.includes("/maps/ph-provinces.json")) return ok(PROVINCES);
    if (url.includes("/statistics/map")) return ok({ focusCouncilId: null, focusCouncilName: "National", places });
    return ok({});
  }));
}

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });

async function render(focus: number | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><CouncilMap focusCouncilId={focus} /></QueryClientProvider>);
  });
  await settle();
}

const click = async (el: Element | null) => { await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const btn = (label: string) => Array.from(container.querySelectorAll("button")).find(b => b.textContent?.trim() === label) ?? null;
const shape = (key: string) => container.querySelector(`path[data-key="${key}"]`);
const svg = () => container.querySelector("svg")!;

beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  urls = []; places = []; resetMapShapeCache(); stub();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("map logic", () => {
  const shapes = PROVINCES.shapes as MapShape[];

  it("sums every code of a multi-code shape (NCR) into one shape", () => {
    const t = aggregate([place("01", 2, 10), place("01", 3, 5)], shapes, "provinces");
    expect(t.get("NCR")?.members).toBe(15);
    expect(t.size).toBe(1);
  });

  it("region totals include province-null rows; both-null rows feed the no-place note", () => {
    const ps = [place("01", 1, 4), place("01", null, 3), place(null, null, 8, 4)];
    expect(aggregate(ps, REGIONS.shapes as MapShape[], "regions").get("R1")?.members).toBe(7);
    expect(unplacedTotals(ps)).toMatchObject({ members: 8, chapters: 4 });
  });

  it("zero is neutral, skewed data gets five nice classes", () => {
    const c = buildClasses(325);
    expect(c.map(x => x.label)).toEqual(["1–5", "6–15", "16–40", "41–100", "101+"]);
    expect(classIndex(0, c)).toBe(-1);
    expect(classIndex(1, c)).toBe(0);
    expect(classIndex(325, c)).toBe(4);
    expect(buildClasses(3)).toHaveLength(5);
  });

  it("zoomBox never throws and skips zoom when the area is the whole country", () => {
    const full = parseViewBox("0 0 1000 1374");
    expect(zoomBox([], full)).toBeNull();
    expect(zoomBox([{ cx: NaN, cy: 1 }], full)).toBeNull();
    expect(zoomBox([{ cx: 100, cy: 100 }, { cx: 900, cy: 1300 }], full)).toBeNull();
    expect(zoomBox([{ cx: 200, cy: 200 }], full)!.w).toBeLessThan(1000);
    expect(parseViewBox("garbage").w).toBe(1000);
  });
});

describe("CouncilMap", () => {
  it("shows the empty state", async () => {
    await render();
    expect(container.textContent).toContain("No chapters in your area yet");
  });

  it("fetches the map file lazily, only for the view shown", async () => {
    places = [place("01", 1, 4), place("02", 4, 2)];
    await render();
    expect(urls.some(u => u.includes("/maps/ph-regions.json"))).toBe(true);
    expect(urls.some(u => u.includes("/maps/ph-provinces.json"))).toBe(false);
    await click(btn("Provinces"));
    await settle();
    expect(urls.some(u => u.includes("/maps/ph-provinces.json"))).toBe(true);
  });

  it("follows the screen's focus council for the API URL", async () => {
    places = [place("01", 1, 4)];
    await render();
    expect(urls.some(u => u.endsWith("/api/councils/statistics/map"))).toBe(true);
    urls = [];
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render(7);
    expect(urls.some(u => u.endsWith("/api/councils/7/statistics/map"))).toBe(true);
  });

  it("tap selects a shape and shows its numbers; tap again clears", async () => {
    places = [place("01", 1, 4, 2, 3), place("02", 4, 2)];
    await render();
    await click(shape("R1"));
    expect(container.textContent).toContain("Region One");
    expect(container.textContent).toContain("2 active of 2");
    await click(shape("R1"));
    expect(container.textContent).not.toContain("2 active of 2");
  });

  it("hover shows the numbers too", async () => {
    places = [place("01", 1, 4), place("02", 4, 2)];
    await render();
    await act(async () => { shape("R2")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(container.textContent).toContain("Region Two");
  });

  it("notes chapters with no place on record", async () => {
    places = [place("01", 1, 4), place("02", 4, 2), place(null, null, 8, 4)];
    await render();
    expect(container.textContent).toContain("8 members in 4 chapters have no place on record, so are not on the map.");
  });

  it("switches measure and view", async () => {
    places = [place("01", 1, 4, 1, 2), place("02", 4, 2)];
    await render();
    await click(btn("App users"));
    expect(container.textContent).toContain("App users per place");
    await click(btn("Chapters"));
    expect(container.textContent).toContain("Chapters per place");
    await click(btn("Provinces"));
    await settle();
    expect(shape("NCR")).not.toBeNull();
    expect(shape("R1")).toBeNull();
  });

  it("list toggle shows places sorted by the measure; a row selects the shape", async () => {
    places = [place("01", 1, 4), place("02", 4, 9)];
    await render();
    await click(btn("Show as a list"));
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows[0]!.textContent).toContain("Region Two");
    await click(rows[1]!);
    expect(container.textContent).toContain("▸ Region One");
  });

  it("zooms into a region, and back to the whole country", async () => {
    places = [place("01", 1, 4), place("02", 4, 9)];
    await render();
    expect(svg().getAttribute("viewBox")).toBe(boxString(parseViewBox("0 0 1000 1374")));
    await click(shape("R1"));
    await click(btn("Zoom into this region"));
    await settle();
    expect(parseViewBox(svg().getAttribute("viewBox")!).w).toBeLessThan(1000);
    expect(shape("P1")).not.toBeNull();
    await click(btn("Whole country"));
    expect(parseViewBox(svg().getAttribute("viewBox")!).w).toBe(1000);
  });

  it("starts zoomed on a jurisdiction that covers only part of the country", async () => {
    places = [place("01", 1, 4)];
    await render();
    expect(parseViewBox(svg().getAttribute("viewBox")!).w).toBeLessThan(1000);
    expect(btn("Whole country")).not.toBeNull();
  });

  it("opens on the whole country when members are spread over several regions (National)", async () => {
    places = [place("01", 1, 4), place("02", 4, 9)];
    await render();
    expect(parseViewBox(svg().getAttribute("viewBox")!).w).toBe(1000);
    expect(btn("Whole country")).toBeNull();
  });
});
