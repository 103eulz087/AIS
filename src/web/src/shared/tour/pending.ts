import type { TourOutcome } from "./types";

/**
 * A finished tour whose report has not reached the server yet (offline, bad signal).
 * Kept in localStorage — this is UI bookkeeping, not domain data — so the next page load
 * can send it, and so the tour does not pop up again in the same browser meanwhile.
 * Every access is try/catch: private mode or a full disk must never break the app.
 */
const STORAGE_KEY = "akrho.tour.pending";

export interface PendingFinish {
  memberId: number;
  tourKey: string;
  tourVersion: number;
  outcome: TourOutcome;
}

function isPending(p: unknown): p is PendingFinish {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.memberId === "number" && typeof o.tourKey === "string"
    && typeof o.tourVersion === "number" && (o.outcome === "Completed" || o.outcome === "Skipped");
}

export function readPending(): PendingFinish[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch { return []; }
}

function write(list: PendingFinish[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* nothing to do */ }
}

const sameTour = (a: PendingFinish, b: PendingFinish) => a.memberId === b.memberId && a.tourKey === b.tourKey;

export function addPending(entry: PendingFinish): void {
  write([...readPending().filter(p => !sameTour(p, entry)), entry]);
}

export function removePending(entry: PendingFinish): void {
  write(readPending().filter(p => !(sameTour(p, entry) && p.tourVersion === entry.tourVersion)));
}

export function hasPending(memberId: number, tourKey: string, tourVersion: number): boolean {
  return readPending().some(p => p.memberId === memberId && p.tourKey === tourKey && p.tourVersion >= tourVersion);
}
