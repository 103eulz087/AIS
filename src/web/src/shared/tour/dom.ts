/** First element carrying data-tour="<target>" that is actually on screen (has a size, not visibility:hidden). */
export function findTarget(target: string): HTMLElement | null {
  try {
    const all = document.querySelectorAll<HTMLElement>(`[data-tour="${target.replace(/"/g, "")}"]`);
    for (const el of Array.from(all)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (window.getComputedStyle(el).visibility === "hidden") continue;
      return el;
    }
  } catch { /* never throw out of the tour */ }
  return null;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

export function isStandalone(): boolean {
  try {
    if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) return true;
    // iPhone Safari's own flag for an app opened from the home screen.
    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

export const NARROW_MAX = 900;

export function isNarrowNow(): boolean {
  try {
    if (typeof window.matchMedia === "function") return window.matchMedia(`(max-width: ${NARROW_MAX - 1}px)`).matches;
  } catch { /* fall through */ }
  return false;
}
