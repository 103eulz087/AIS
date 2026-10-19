import type { GuideContext, TourStep, TutorialRow } from "./types";

/**
 * A how-to guide: a walk through the REAL screens, one control at a time.
 *
 * One file per guide (ais/guides/<name>.tsx or portal/guides/<name>.tsx) exporting one
 * GuideDefinition, listed in that app's guides/index.ts. The Help page, the "Done" tick and
 * the Start button all come for free from the definition — a guide file never touches them.
 */
export interface GuideDefinition {
  /** Exactly the server catalogue key, e.g. "guide-meetings". Also the tutorials tourKey. */
  key: string;
  /** Short and plain: "Set up a meeting". */
  title: string;
  /** One friendly sentence for the Help page. */
  summary: string;
  /** Heading it sits under on the Help page ("For every member", "For chapter officers", "Chapters"...). */
  group: string;
  /** Who is shown this guide. Must match what the screens themselves allow, so nobody is walked to a locked door. */
  audience: (ctx: GuideContext) => boolean;
  /** Bump when the guide changes enough that people who finished the old one should see a fresh "not done" mark. */
  version: number;
  /** The steps. Called when the guide starts (and to count steps for the Help page) — keep it cheap and free of network calls; do lookups inside a step's route function instead. */
  buildSteps: (ctx: GuideContext) => TourStep[];
}

/** "About N steps" for the Help page. Never throws. */
export function guideStepCount(g: GuideDefinition, ctx: GuideContext): number {
  try { return g.buildSteps(ctx).length; } catch { return 0; }
}

/** The guides this person should see, in registry order. Never throws on a bad audience function. */
export function guidesFor(guides: readonly GuideDefinition[], ctx: GuideContext): GuideDefinition[] {
  return guides.filter(g => { try { return g.audience(ctx); } catch { return false; } });
}

/** Groups in order of first appearance. */
export function groupGuides(guides: readonly GuideDefinition[]): Array<{ heading: string; guides: GuideDefinition[] }> {
  const out: Array<{ heading: string; guides: GuideDefinition[] }> = [];
  for (const g of guides) {
    let bucket = out.find(b => b.heading === g.group);
    if (!bucket) { bucket = { heading: g.group, guides: [] }; out.push(bucket); }
    bucket.guides.push(g);
  }
  return out;
}

/** True when the member finished (not skipped) this guide at this version or newer. */
export function isGuideDone(g: GuideDefinition, rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((r: unknown) => {
    if (!r || typeof r !== "object") return false;
    const o = r as Partial<TutorialRow>;
    return o.tourKey === g.key && typeof o.tourVersion === "number" && o.tourVersion >= g.version
      && o.outcome !== "Skipped";
  });
}

/**
 * Run an async lookup once per guide run and share the answer between steps (several steps
 * on the same detail page all need the same id). Rejections become null.
 */
export function lazyOnce<T>(fn: () => Promise<T>): () => Promise<T | null> {
  let p: Promise<T | null> | null = null;
  return () => {
    if (!p) p = fn().catch(() => null);
    return p;
  };
}
