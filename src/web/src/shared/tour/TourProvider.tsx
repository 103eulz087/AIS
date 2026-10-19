import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { findTarget, isNarrowNow, isStandalone } from "./dom";
import { addPending, readPending, removePending, type PendingFinish } from "./pending";
import { TourOverlay } from "./TourOverlay";
import {
  TUTORIALS_QUERY_KEY, type GuideContext, type TourDefinition, type TourOutcome, type TourStep, type TutorialRow,
} from "./types";

/** How long a step's target gets to show up (after we are on the right page) before the step is quietly dropped. */
const TARGET_WAIT_MS = 1500;
/** How long we wait for a navigation to land before giving up on a step. */
const ROUTE_WAIT_MS = 3000;
/** What a step's route function sees when the tour was started without a context. */
const NO_CTX: GuideContext = { claims: null, roles: [], seats: [], isFeatureOpen: () => true };

interface Run {
  tourKey: string;
  tourVersion: number;
  steps: TourStep[];
  index: number;
  /** 1 moving forward, -1 moving back — decides where to land when a step is dropped. */
  dir: 1 | -1;
  /** Passed to step route functions. */
  ctx: GuideContext;
  /** Where the tour began, and whether to go back there when it ends (how-to guides do). */
  startPath: string;
  returnToStart: boolean;
}

export interface TourApi {
  active: boolean;
  tourKey: string | null;
  currentStep: TourStep | null;
  start: (def: TourDefinition) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const NOOP_API: TourApi = {
  active: false, tourKey: null, currentStep: null,
  start: () => { /* no provider */ }, next: () => { /* no provider */ },
  back: () => { /* no provider */ }, skip: () => { /* no provider */ },
};

const TourContext = createContext<TourApi>(NOOP_API);

/** Safe anywhere: outside a TourProvider it does nothing (Profile's replay button, tests). */
export function useTour(): TourApi {
  return useContext(TourContext);
}

async function sendFinish(entry: PendingFinish): Promise<boolean> {
  try {
    await api.post(`/api/members/me/tutorials/${entry.tourKey}/finish`,
      { tourVersion: entry.tourVersion, outcome: entry.outcome });
    removePending(entry);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs a step-by-step tour over the page.
 * Mount once inside a shell (inside the Router and QueryClientProvider). `memberId` is the
 * signed-in member — used only to keep a not-yet-sent "finished" report with its owner.
 *
 * Never throws: a missing target, a failed report or a blocked localStorage just means the
 * tour ends quietly. See TourOverlay for the look and the keyboard/screen-reader behaviour.
 */
export function TourProvider({ memberId, children }: { memberId: number | undefined; children: ReactNode }) {
  const [run, setRun] = useState<Run | null>(null);
  const [ready, setReady] = useState(false);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const qc = useQueryClient();

  // A guide that walked through other screens leaves the person where he started it (the Help page).
  const leave = useCallback((r: Run) => {
    try {
      if (r.returnToStart && pathRef.current !== r.startPath) navigate(r.startPath);
    } catch { /* never throw out of the tour */ }
  }, [navigate]);

  const finish = useCallback((outcome: TourOutcome) => {
    const r = runRef.current;
    if (!r) return;
    runRef.current = null;
    setRun(null);
    setReady(false);
    leave(r);
    const entry: PendingFinish = { memberId: memberId ?? 0, tourKey: r.tourKey, tourVersion: r.tourVersion, outcome };
    addPending(entry);
    // Treat it as seen straight away, so nothing re-starts it while the report is on its way.
    qc.setQueryData<unknown>(TUTORIALS_QUERY_KEY, (old: unknown) => {
      if (!Array.isArray(old)) return old;
      const row: TutorialRow = { tourKey: r.tourKey, tourVersion: r.tourVersion, outcome, finishedDate: new Date().toISOString() };
      return [...old.filter((o: Partial<TutorialRow>) => o?.tourKey !== r.tourKey), row];
    });
    void sendFinish(entry);
  }, [memberId, qc, leave]);

  // Send any report an earlier visit could not deliver.
  useEffect(() => {
    if (memberId === undefined) return;
    for (const p of readPending()) {
      if (p.memberId === memberId) void sendFinish(p);
    }
  }, [memberId]);

  const start = useCallback((def: TourDefinition) => {
    try {
      if (runRef.current) return;
      const env = { narrow: isNarrowNow(), standalone: isStandalone() };
      const steps = def.steps.filter(s => {
        try { return s.when ? s.when(env) : true; } catch { return false; }
      });
      if (steps.length === 0) return;
      const next: Run = {
        tourKey: def.tourKey, tourVersion: def.tourVersion, steps, index: 0, dir: 1,
        ctx: def.ctx ?? NO_CTX, startPath: pathRef.current, returnToStart: def.returnToStart === true,
      };
      runRef.current = next;
      setReady(false);
      setRun(next);
    } catch { /* never throw out of start() */ }
  }, []);

  const next = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    if (r.index >= r.steps.length - 1) { finish("Completed"); return; }
    setReady(false);
    setRun({ ...r, index: r.index + 1, dir: 1 });
  }, [finish]);

  const back = useCallback(() => {
    const r = runRef.current;
    if (!r || r.index <= 0) return;
    setReady(false);
    setRun({ ...r, index: r.index - 1, dir: -1 });
  }, []);

  const skip = useCallback(() => finish("Skipped"), [finish]);

  // Drop the current step (its page or target never showed up) and move on in the direction we were going.
  const dropCurrent = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    const steps = r.steps.filter((_, i) => i !== r.index);
    if (steps.length === 0) { runRef.current = null; setRun(null); setReady(false); leave(r); return; }
    const index = r.dir === 1 ? r.index : Math.max(0, r.index - 1);
    if (index >= steps.length) {
      // Nothing left after the dropped one: the tour has been seen to its end.
      const trimmed = { ...r, steps, index: steps.length - 1 };
      runRef.current = trimmed;
      finish("Completed");
      return;
    }
    const nextRun = { ...r, steps, index };
    runRef.current = nextRun;
    setReady(false);
    setRun(nextRun);
  }, [finish, leave]);

  // While a tour runs nothing may be saved: the overlay swallows taps, and this stops any form
  // submit (Enter in a field, a stray key press) before the page's own handlers see it.
  const running = run !== null;
  useEffect(() => {
    if (!running) return;
    const block = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    document.addEventListener("submit", block, true);
    return () => document.removeEventListener("submit", block, true);
  }, [running]);

  // Get each step ready: go to its page, wait for its target, or drop it.
  const stepId = run ? run.steps[run.index]?.id : undefined;
  const runKey = run ? run.tourKey : undefined;
  useEffect(() => {
    const r = runRef.current;
    if (!r) return;
    const step = r.steps[r.index];
    if (!step) return;
    const targetWait = step.waitMs ?? TARGET_WAIT_MS;
    let done = false;
    let timerId: number | undefined;
    const samePage = (path: string) => pathRef.current === path.split("?")[0];
    // Once we know which page the step belongs to: go there, then wait for its target.
    const begin = (path: string | undefined) => {
      const startedAt = Date.now();
      let routeSince: number | null = null;
      let navigated = false;
      const tick = () => {
        if (done) return;
        try {
          if (path !== undefined && !samePage(path)) {
            if (!navigated) { navigated = true; navigate(path); }
            if (Date.now() - startedAt > ROUTE_WAIT_MS) { done = true; dropCurrent(); }
            return;
          }
          if (routeSince === null) routeSince = Date.now();
          if (!step.target) { done = true; setReady(true); return; }
          if (findTarget(step.target)) { done = true; setReady(true); return; }
          if (Date.now() - routeSince > targetWait) { done = true; dropCurrent(); }
        } catch {
          done = true; dropCurrent();
        }
      };
      tick();
      if (!done) timerId = window.setInterval(tick, 50);
    };
    if (typeof step.route === "function") {
      // The page depends on data (an id, say). null or a failure means: leave this step out.
      const resolve = step.route;
      void (async () => {
        let path: string | null = null;
        try { path = await resolve(r.ctx); } catch { path = null; }
        if (done) return;
        if (!path) { done = true; dropCurrent(); return; }
        begin(path);
      })();
    } else {
      begin(step.route);
    }
    return () => { done = true; if (timerId !== undefined) window.clearInterval(timerId); };
    // Re-run only when the step itself changes.
  }, [stepId, runKey, run?.index]);

  const currentStep = run ? run.steps[run.index] ?? null : null;

  const value = useMemo<TourApi>(() => ({
    active: run !== null, tourKey: run?.tourKey ?? null, currentStep, start, next, back, skip,
  }), [run, currentStep, start, next, back, skip]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {run && currentStep && (
        <TourOverlay
          step={currentStep}
          index={run.index}
          total={run.steps.length}
          ready={ready}
          onNext={next}
          onBack={back}
          onSkip={skip}
        />
      )}
    </TourContext.Provider>
  );
}

