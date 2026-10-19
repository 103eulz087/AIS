import type { ReactNode } from "react";

/** What a step's `when` can look at. Kept tiny on purpose: anything else is decided by the code that builds the steps. */
export interface TourEnv {
  /** Phone-width screen (under 900px) — the same breakpoint the Portal uses. */
  narrow: boolean;
  /** The app is running as an installed app (home-screen icon), not in a browser tab. */
  standalone: boolean;
}

export interface TourStep {
  id: string;
  /** Matches an element carrying data-tour="<target>". No target: a centred card. */
  target?: string;
  /** Go to this page first (exact path). */
  route?: string;
  title: string;
  body: ReactNode;
  /** Return false to leave this step out. Checked once, before the tour starts, so "Step N of M" is honest. */
  when?: (env: TourEnv) => boolean;
}

export type TourOutcome = "Completed" | "Skipped";

export interface TourDefinition {
  /** "ais-welcome" or "portal-welcome". */
  tourKey: string;
  tourVersion: number;
  steps: TourStep[];
}

/** One row of GET /api/members/me/tutorials. */
export interface TutorialRow {
  tourKey: string;
  tourVersion: number;
  outcome: TourOutcome;
  finishedDate: string;
}

export const TUTORIALS_QUERY_KEY = ["member-tutorials"] as const;
export const AIS_TOUR_KEY = "ais-welcome";
export const PORTAL_TOUR_KEY = "portal-welcome";
/** Bump when the tour changes enough that members who saw the old one should see it again. */
export const AIS_TOUR_VERSION = 1;
export const PORTAL_TOUR_VERSION = 1;
