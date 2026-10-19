import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { hasPending } from "./pending";
import { useTour } from "./TourProvider";
import { TUTORIALS_QUERY_KEY, type TourStep } from "./types";

/** The page settles for a moment before the tour appears, so it never fights the first paint. */
const START_DELAY_MS = 600;

interface Options {
  tourKey: string;
  tourVersion: number;
  /** False on pages where the tour must not start (anything but Home for the AIS). */
  enabled: boolean;
  buildSteps: () => TourStep[];
}

/**
 * Starts a member's welcome tour the first time he reaches the right screen.
 * GET /api/members/me/tutorials -> [{ tourKey, tourVersion, outcome, finishedDate }].
 *
 * Starts only when the answer is a real list that has no row for this tour at this version
 * or newer. If the answer is missing, errored or not a list, it does NOT start — a tour we
 * cannot be sure he hasn't seen is worse than no tour. Same when a finish report is still
 * waiting to be sent from this browser.
 */
export function useTourAutoStart({ tourKey, tourVersion, enabled, buildSteps }: Options): void {
  const { claims } = useAuth();
  const tour = useTour();
  const build = useRef(buildSteps);
  build.current = buildSteps;
  const startedFor = useRef<string | null>(null);

  const query = useQuery({
    queryKey: TUTORIALS_QUERY_KEY,
    queryFn: () => api.get<unknown>("/api/members/me/tutorials"),
    enabled: !!claims,
    staleTime: Infinity,
    retry: false,
  });

  const rows = query.data;
  const memberId = claims?.memberId;
  let shouldStart = false;
  if (enabled && memberId !== undefined && Array.isArray(rows)) {
    const seen = rows.some((r: unknown) => {
      if (!r || typeof r !== "object") return false;
      const o = r as { tourKey?: unknown; tourVersion?: unknown };
      return o.tourKey === tourKey && typeof o.tourVersion === "number" && o.tourVersion >= tourVersion;
    });
    shouldStart = !seen && !hasPending(memberId, tourKey, tourVersion);
  }

  const { active, start } = tour;
  useEffect(() => {
    if (!shouldStart || active) return;
    const sessionKey = `${memberId}:${tourKey}:${tourVersion}`;
    if (startedFor.current === sessionKey) return;
    const timer = window.setTimeout(() => {
      try { 
        const steps = build.current();
        startedFor.current = sessionKey;
        start({ tourKey, tourVersion, steps });
      } catch { /* never let the tour break the page */ }
    }, START_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [shouldStart, active, start, memberId, tourKey, tourVersion]);
}
