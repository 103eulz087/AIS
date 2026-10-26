/**
 * Pure helpers for the "Where your members are" map on Council Statistics.
 * Counts only — never names of members (CLAUDE.md invariant #7).
 */

export interface MapShape {
  key: string;
  name: string;
  regionCode: string;
  provinceCodes?: number[];
  d: string;
  cx: number;
  cy: number;
}

export interface MapShapesFile {
  viewBox: string;
  attribution: string;
  shapes: MapShape[];
}

export interface MapPlace {
  regionCode: string | null;
  provinceCode: number | null;
  chapters: number;
  activeChapters: number;
  members: number;
  appUsers: number;
}

export interface MapResponse {
  focusCouncilId: number | null;
  focusCouncilName: string;
  places: MapPlace[];
}

export type MapView = "regions" | "provinces";
export type Measure = "members" | "appUsers" | "chapters";

export interface Totals { members: number; appUsers: number; chapters: number; activeChapters: number }

export const EMPTY_TOTALS: Totals = { members: 0, appUsers: 0, chapters: 0, activeChapters: 0 };

function add(a: Totals, p: MapPlace): Totals {
  return {
    members: a.members + p.members,
    appUsers: a.appUsers + p.appUsers,
    chapters: a.chapters + p.chapters,
    activeChapters: a.activeChapters + p.activeChapters,
  };
}

/** Totals per shape key. Region = every place with that regionCode (province-null rows included);
 * province shape = sum of every code in its provinceCodes (NCR stands for 17 cities). */
export function aggregate(places: readonly MapPlace[], shapes: readonly MapShape[], view: MapView): Map<string, Totals> {
  const out = new Map<string, Totals>();
  if (view === "regions") {
    const byRegion = new Map<string, string>();
    for (const s of shapes) byRegion.set(s.regionCode, s.key);
    for (const p of places) {
      const key = p.regionCode != null ? byRegion.get(p.regionCode) : undefined;
      if (key) out.set(key, add(out.get(key) ?? EMPTY_TOTALS, p));
    }
  } else {
    const byCode = new Map<number, string>();
    for (const s of shapes) for (const c of s.provinceCodes ?? []) byCode.set(c, s.key);
    for (const p of places) {
      const key = p.provinceCode != null ? byCode.get(p.provinceCode) : undefined;
      if (key) out.set(key, add(out.get(key) ?? EMPTY_TOTALS, p));
    }
  }
  return out;
}

/** Chapters with no place on record at all (both codes null) — never dropped silently. */
export function unplacedTotals(places: readonly MapPlace[]): Totals {
  return places.filter(p => p.regionCode == null && p.provinceCode == null).reduce(add, EMPTY_TOTALS);
}

/** Chapters that have a region but no province: on the Regions map, but not on the Provinces map. */
export function regionOnlyTotals(places: readonly MapPlace[]): Totals {
  return places.filter(p => p.regionCode != null && p.provinceCode == null).reduce(add, EMPTY_TOTALS);
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ colour classes */

/** Sequential, one hue, light to dark. Validated ordinal ramp on a white surface. */
export const RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"] as const;
export const NEUTRAL = "var(--bond)";

export interface MapClass { label: string; color: string; max: number }

/** Four upper bounds from the data's maximum; the fifth class is "everything above". */
export function breakBounds(max: number): number[] {
  if (max <= 5) return [1, 2, 3, 4];
  if (max <= 15) return [2, 5, 9, 13];
  if (max <= 40) return [5, 12, 22, 32];
  let scale = 1;
  while (1000 * scale < max && scale < 1e9) scale *= 10;
  return [5, 15, 40, 100].map(b => b * scale);
}

export function buildClasses(max: number): MapClass[] {
  const b = breakBounds(Math.max(0, Math.floor(Number.isFinite(max) ? max : 0)));
  const fmt = (n: number) => n.toLocaleString("en-PH");
  return RAMP.map((color, i) => {
    const lo = i === 0 ? 1 : (b[i - 1] ?? 0) + 1;
    if (i === 4) return { label: `${fmt(lo)}+`, color, max: Infinity };
    const hi = b[i] ?? 0;
    return { label: lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`, color, max: hi };
  });
}

/** -1 = none (neutral); 0..4 = ramp class. */
export function classIndex(value: number, classes: readonly MapClass[]): number {
  if (!(value > 0)) return -1;
  const i = classes.findIndex(c => value <= c.max);
  return i < 0 ? classes.length - 1 : i;
}

/* ------------------------------------------------------------------------- zoom */

export interface Box { x: number; y: number; w: number; h: number }

export function parseViewBox(vb: string | undefined): Box {
  const n = (vb ?? "").trim().split(/[\s,]+/).map(Number);
  const [x, y, w, h] = n;
  if (n.length === 4 && n.every(Number.isFinite) && w! > 0 && h! > 0) return { x: x!, y: y!, w: w!, h: h! };
  return { x: 0, y: 0, w: 1000, h: 1374 };
}

/**
 * A box around the given shapes' centre points (plus a margin), in the full map's aspect ratio.
 * Returns null when the box would cover most of the country anyway (so no zoom is needed),
 * unless force is set (zooming into a chosen region). Never throws.
 */
export function zoomBox(shapes: readonly Pick<MapShape, "cx" | "cy">[], full: Box, force = false): Box | null {
  const pts = shapes.filter(s => Number.isFinite(s.cx) && Number.isFinite(s.cy));
  if (pts.length === 0) return null;
  const xs = pts.map(s => s.cx), ys = pts.map(s => s.cy);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = full.w * 0.08;
  const ratio = full.h / full.w;
  const w = Math.max(full.w * 0.26, maxX - minX + pad * 2, (maxY - minY + pad * 2) / ratio);
  if (!force && w >= full.w * 0.7) return null;
  const width = Math.min(w, full.w);
  const height = width * ratio;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const x = Math.min(Math.max(full.x, cx - width / 2), full.x + full.w - width);
  const y = Math.min(Math.max(full.y, cy - height / 2), full.y + full.h - height);
  return { x, y, w: width, h: height };
}

export function boxString(b: Box): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${r(b.x)} ${r(b.y)} ${r(b.w)} ${r(b.h)}`;
}

/* ---------------------------------------------------------------- shape file cache */

const shapeCache = new Map<MapView, Promise<MapShapesFile>>();

/** Fetched only when the map renders; one request per file for the life of the page. */
export function loadMapShapes(view: MapView): Promise<MapShapesFile> {
  let p = shapeCache.get(view);
  if (!p) {
    const url = view === "regions" ? "/maps/ph-regions.json" : "/maps/ph-provinces.json";
    p = fetch(url).then(async res => {
      if (!res.ok) throw new Error("The map could not be loaded.");
      const json = await res.json() as MapShapesFile;
      if (!json || !Array.isArray(json.shapes)) throw new Error("The map could not be loaded.");
      return json;
    });
    p.catch(() => shapeCache.delete(view));
    shapeCache.set(view, p);
  }
  return p;
}

export function resetMapShapeCache(): void { shapeCache.clear(); }
