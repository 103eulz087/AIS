import type { ReactNode } from "react";
import type { Claims } from "@/shared/auth";
import type { CouncilSeatPermissions } from "@/shared/types";

/** What a step's `when` can look at. Kept tiny on purpose: anything else is decided by the code that builds the steps. */
export interface TourEnv {
  /** Phone-width screen (under 900px) — the same breakpoint the Portal uses. */
  narrow: boolean;
  /** The app is running as an installed app (home-screen icon), not in a browser tab. */
  standalone: boolean;
}

/**
 * What a guide (and a step's route function) may look at. Built by useGuideContext().
 * Plain data plus one function, so guides stay easy to unit-test: pass a literal.
 */
export interface GuideContext {
  claims: Claims | null;
  roles: readonly string[];
  seats: readonly CouncilSeatPermissions[];
  /** Free-trial gate for the member app. Always true for features that are never closed. */
  isFeatureOpen: (featureKey: string) => boolean;
}

/** A step's page: an exact path, or a function that works it out at run time (null = skip this step). */
export type StepRoute = string | ((ctx: GuideContext) => string | null | Promise<string | null>);

export interface TourStep {
  id: string;
  /** Matches an element carrying data-tour="<target>". No target: a centred card. */
  target?: string;
  /**
   * Go to this page first. An exact path, or a function of the guide context that returns the
   * path (it may look data up, so it may return a Promise). Returning null (or throwing) drops
   * the step quietly. Steps with no route stay on whatever page the previous step was on.
   */
  route?: StepRoute;
  /** How long to wait for the target to appear once on the page. Default 1500ms; raise it for screens that load data first. */
  waitMs?: number;
  title: string;
  body: ReactNode;
  /** A small picture at the top of the card (see illustrations.tsx). Decorative: keep it aria-hidden. */
  illustration?: ReactNode;
  /** One short "Tip:" line under the body. */
  tip?: string;
  /** Return false to leave this step out. Checked once, before the tour starts, so "Step N of M" is honest. */
  when?: (env: TourEnv) => boolean;
}

export type TourOutcome = "Completed" | "Skipped";

export interface TourDefinition {
  /** "ais-welcome" or "portal-welcome". */
  tourKey: string;
  tourVersion: number;
  steps: TourStep[];
  /** Passed to route functions. */
  ctx?: GuideContext;
  /** When the tour ends (finished, skipped or dropped), go back to the page it was started from. Guides set this. */
  returnToStart?: boolean;
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
export const AIS_TOUR_VERSION = 2;
export const PORTAL_TOUR_VERSION = 2;
