import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { findTarget, NARROW_MAX, prefersReducedMotion } from "./dom";
import { ILLUS_CSS } from "./illustrations";
import type { TourStep } from "./types";

interface Box { left: number; top: number; width: number; height: number; id?: string }

interface Props {
  step: TourStep;
  index: number;
  total: number;
  /** False while we are still going to the step's page or waiting for its target. */
  ready: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const PAD = 6;          // breathing room around the highlighted thing
const GAP = 14;         // space between highlight and card (desktop)
const EDGE = 12;        // keep the card this far from the screen edge
const CARD_W = 360;

interface Placement {
  left: number; top: number;
  /** Which edge of the card faces the target (where the little arrow sits). */
  arrow: "left" | "right" | "top" | "bottom" | null;
  /** Arrow position along that edge, in px from the card's start. */
  arrowAt: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Desktop: beside the target, flipping to whichever side fits. */
function placeBeside(t: Box, vw: number, vh: number, cw: number, ch: number): Placement {
  const cx = t.left + t.width / 2;
  const cy = t.top + t.height / 2;
  const right = t.left + t.width + GAP;
  if (right + cw <= vw - EDGE) {
    const top = clamp(cy - ch / 2, EDGE, vh - ch - EDGE);
    return { left: right, top, arrow: "left", arrowAt: clamp(cy - top, 22, ch - 22) };
  }
  const leftSide = t.left - GAP - cw;
  if (leftSide >= EDGE) {
    const top = clamp(cy - ch / 2, EDGE, vh - ch - EDGE);
    return { left: leftSide, top, arrow: "right", arrowAt: clamp(cy - top, 22, ch - 22) };
  }
  const below = t.top + t.height + GAP;
  if (below + ch <= vh - EDGE) {
    const left = clamp(cx - cw / 2, EDGE, vw - cw - EDGE);
    return { left, top: below, arrow: "top", arrowAt: clamp(cx - left, 22, cw - 22) };
  }
  const above = t.top - GAP - ch;
  if (above >= EDGE) {
    const left = clamp(cx - cw / 2, EDGE, vw - cw - EDGE);
    return { left, top: above, arrow: "bottom", arrowAt: clamp(cx - left, 22, cw - 22) };
  }
  return { left: clamp((vw - cw) / 2, EDGE, vw - cw - EDGE), top: clamp((vh - ch) / 2, EDGE, vh - ch - EDGE), arrow: null, arrowAt: 0 };
}

const FOCUSABLE = "button:not([disabled])";

/** "Hide the picture" is remembered for the rest of the visit (memory only), so it stays hidden step to step. */
let hideArtChoice = false;

/**
 * The dimmed page, the spotlight and the card.
 *
 * - Everything is drawn in a portal on document.body above the app. A transparent layer covers
 *   the whole screen, so taps and clicks never reach the highlighted thing — nobody wanders off
 *   mid-step.
 * - The card is a labelled modal dialog. Focus moves into it and stays there (Tab wraps);
 *   Esc skips the tour; Left/Right arrows go back/next; a polite live region reads out each step.
 * - Under 900px the card docks as a sheet at the bottom of the screen, or at the top when the
 *   highlighted thing sits in the lower half (e.g. the bottom tab bar), so it never covers it.
 * - Animation is switched off when the phone asks for reduced motion.
 */
export function TourOverlay({ step, index, total, ready, onNext, onBack, onSkip }: Props) {
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [rawBox, setBox] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [hideArt, setHideArt] = useState(hideArtChoice);
  hideArtChoice = hideArt;
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const reduced = prefersReducedMotion();
  const narrow = viewport.w < NARROW_MAX;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const titleId = `tour-title-${step.id}`;
  const bodyId = `tour-body-${step.id}`;

  // Latest handlers for the key listener, so it can be attached once.
  const handlers = useRef({ onNext, onBack, onSkip, isFirst });
  handlers.current = { onNext, onBack, onSkip, isFirst };

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Remember what had focus, give it back at the end.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => { try { if (before && document.contains(before)) before.focus(); } catch { /* ignore */ } };
  }, []);

  // Keys. Capture phase so the page's own Esc handlers (e.g. the Portal drawer) don't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const h = handlers.current;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); h.onSkip(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); h.onNext(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); if (!h.isFirst) h.onBack(); return; }
      // Enter or Space anywhere outside the card must never reach the page underneath (a form, a button).
      if ((e.key === "Enter" || e.key === " ") && !cardRef.current?.contains(e.target as Node | null)) {
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.key === "Tab") {
        const card = cardRef.current;
        if (!card) { e.preventDefault(); return; }
        const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) { e.preventDefault(); return; }
        const active = document.activeElement as HTMLElement | null;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (!active || !card.contains(active)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Bring the target into view once, then keep following it (scroll, resize, drawer sliding in...).
  useEffect(() => {
    if (!ready) return;
    if (!step.target) { setBox(null); return; }
    const first = findTarget(step.target);
    try {
      first?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    } catch { /* ignore */ }
    let stop = false;
    let last = "";
    let timer = 0;
    const schedule = (fn: () => void) => {
      if (typeof window.requestAnimationFrame === "function") timer = window.requestAnimationFrame(fn);
      else timer = window.setTimeout(fn, 16);
    };
    const loop = () => {
      if (stop) return;
      const el = findTarget(step.target!);
      if (el) {
        const r = el.getBoundingClientRect();
        const key = `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.width)}|${Math.round(r.height)}`;
        if (key !== last) {
          last = key;
          setBox({ left: r.left, top: r.top, width: r.width, height: r.height, id: step.id });
        }
      }
      schedule(loop);
    };
    loop();
    return () => {
      stop = true;
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(timer);
      window.clearTimeout(timer);
    };
  }, [ready, step.id, step.target, reduced]);

  // The spotlight may still be gliding over from the last step; the card waits for this step's own measurement.
  const box = rawBox && rawBox.id === step.id ? rawBox : null;
  const hasTarget = !!step.target && !!box;
  const waitingForBox = !!step.target && !box;
  const padded: Box | null = rawBox
    ? { left: rawBox.left - PAD, top: rawBox.top - PAD, width: rawBox.width + PAD * 2, height: rawBox.height + PAD * 2 }
    : null;
  const targetInLowerHalf = !!box && box.top + box.height / 2 > viewport.h / 2;

  // Desktop placement needs the card's real height.
  useLayoutEffect(() => {
    if (!ready || narrow || !hasTarget || !box || !cardRef.current) { setPlacement(null); return; }
    const cw = Math.min(CARD_W, viewport.w - EDGE * 2);
    const ch = cardRef.current.offsetHeight || 220;
    setPlacement(placeBeside({ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }, viewport.w, viewport.h, cw, ch));
  }, [ready, narrow, hasTarget, rawBox, viewport.w, viewport.h, step.id]);

  // Focus goes into the card whenever it appears (and after each step swap). On a phone the
  // card is a capped-height sheet that scrolls when a step is long: each step starts at its
  // top (picture and title first), and focusing Next must not scroll it down to the buttons.
  useEffect(() => {
    if (!ready || (!!step.target && !box)) return;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) nextRef.current?.focus({ preventScroll: true });
  }, [ready, step.id, step.target, box]);
  useEffect(() => {
    if (cardRef.current) cardRef.current.scrollTop = 0;
  }, [step.id]);

  const cardStyle: CSSProperties = (() => {
    const base: CSSProperties = {
      position: "fixed", zIndex: 2001, boxSizing: "border-box", background: "var(--paper)", color: "var(--ink)",
      borderRadius: "var(--r)", boxShadow: "0 12px 40px rgba(14,17,22,.45)", borderTop: "3px solid var(--brass)",
      padding: "16px 16px 12px", maxHeight: "min(70dvh, 520px)",
      visibility: waitingForBox ? "hidden" : "visible",
    };
    if (!hasTarget) {
      return { ...base, overflowY: "auto", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: `min(${CARD_W + 40}px, calc(100vw - 24px))` };
    }
    if (narrow) {
      return targetInLowerHalf
        ? { ...base, overflowY: "auto", left: 8, right: 8, top: "max(8px, env(safe-area-inset-top))", maxHeight: "46dvh" }
        : { ...base, overflowY: "auto", left: 8, right: 8, bottom: "max(8px, env(safe-area-inset-bottom))", maxHeight: "46dvh" };
    }
    const p = placement;
    return {
      ...base, width: Math.min(CARD_W, viewport.w - EDGE * 2),
      left: p ? p.left : EDGE, top: p ? p.top : EDGE, visibility: p ? "visible" : "hidden",
    };
  })();

  const arrow = !narrow && hasTarget && placement?.arrow ? placement : null;
  const live = `Step ${index + 1} of ${total}: ${step.title}`;

  return createPortal(
    <div data-testid="tour-overlay">
      <style>{TOUR_CSS + ILLUS_CSS}</style>

      {/* Swallows every tap so the highlighted thing can't be used mid-tour. */}
      <div
        aria-hidden="true"
        onClick={e => { e.preventDefault(); e.stopPropagation(); }}
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: "fixed", inset: 0, zIndex: 2000,
          background: padded ? "transparent" : "rgba(14,17,22,.74)",
        }}
      />
      {padded && (
        <div
          aria-hidden="true"
          className={reduced ? undefined : "tour-spot"}
          style={{
            position: "fixed", zIndex: 2000, pointerEvents: "none", borderRadius: 12,
            left: padded.left, top: padded.top, width: padded.width, height: padded.height,
            boxShadow: "0 0 0 2px var(--brass), 0 0 0 9999px rgba(14,17,22,.74)",
          }}
        />
      )}

      <div role="status" aria-live="polite" style={srOnly}>{ready ? live : ""}</div>

      {ready && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className={reduced ? undefined : "tour-card"}
          style={cardStyle}
        >
          {arrow && <span aria-hidden="true" style={arrowStyle(arrow)} />}
          {step.illustration && !(narrow && hideArt) && (
            <div
              aria-hidden="true" className="tour-illus" data-testid="tour-illustration"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                maxHeight: narrow ? 120 : 170, marginBottom: 10, padding: 6, borderRadius: 8,
                background: "var(--bond)", border: "1px solid var(--line)",
              }}
            >
              {step.illustration}
            </div>
          )}
          <h2 id={titleId} style={{ margin: 0, fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em", lineHeight: 1.15 }}>
            {step.title}
          </h2>
          <div id={bodyId} style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.5, color: "var(--slate)" }}>
            {step.body}
          </div>
          {step.tip && (
            <p data-testid="tour-tip" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--slate)" }}>
              <strong style={{ color: "var(--brass-dk)" }}>Tip:</strong> {step.tip}
            </p>
          )}
          {step.illustration && narrow && (
            <button type="button" onClick={() => setHideArt(h => !h)} style={{ ...ghostBtn, paddingLeft: 0, marginTop: 4, fontSize: 13 }}>
              {hideArt ? "Show the picture" : "Hide the picture"}
            </button>
          )}

          {/* Progress + buttons stay pinned to the bottom of the card, so Back/Next are always
              in reach even when a long step makes the phone sheet scroll. */}
          <div style={{ position: "sticky", bottom: -12, marginBottom: -12, paddingBottom: 12, background: "inherit" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 14 }}>
            <div aria-hidden="true" style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} style={{
                  width: i === index ? 16 : 6, height: 6, borderRadius: 3,
                  background: i === index ? "var(--brass)" : i < index ? "var(--slate)" : "var(--line)",
                  transition: reduced ? undefined : "width .2s",
                }} />
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--mute)", whiteSpace: "nowrap" }}>
              Step <span className="num">{index + 1}</span> of <span className="num">{total}</span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            {!isLast ? (
              <button type="button" onClick={onSkip} style={ghostBtn}>Skip tour</button>
            ) : <span style={{ flex: 1 }} />}
            <span style={{ flex: 1 }} />
            {!isFirst && <button type="button" onClick={onBack} style={outlineBtn}>Back</button>}
            <button type="button" ref={nextRef} onClick={onNext} style={primaryBtn}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function arrowStyle(p: Placement): CSSProperties {
  const s: CSSProperties = {
    position: "absolute", width: 12, height: 12, background: "var(--paper)", transform: "rotate(45deg)",
  };
  if (p.arrow === "left") return { ...s, left: -6, top: p.arrowAt - 6 };
  if (p.arrow === "right") return { ...s, right: -6, top: p.arrowAt - 6 };
  if (p.arrow === "top") return { ...s, top: -7, left: p.arrowAt - 6, background: "var(--brass)" };
  return { ...s, bottom: -6, left: p.arrowAt - 6 };
}

const btnBase: CSSProperties = {
  minHeight: 44, minWidth: 44, padding: "0 16px", borderRadius: "var(--r)", fontSize: 14.5, fontWeight: 600,
  cursor: "pointer",
};
const primaryBtn: CSSProperties = { ...btnBase, background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--ink)", minWidth: 88 };
const outlineBtn: CSSProperties = { ...btnBase, background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" };
const ghostBtn: CSSProperties = { ...btnBase, background: "transparent", color: "var(--mute)", border: "1px solid transparent", fontWeight: 500, paddingLeft: 4, paddingRight: 8 };

const srOnly: CSSProperties = {
  position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};

const TOUR_CSS = `
.tour-spot { transition: left .22s ease, top .22s ease, width .22s ease, height .22s ease; }
.tour-card { animation: tour-in .18s ease-out; }
@media (max-height: 520px) { .tour-illus { display: none !important; } }
@keyframes tour-in { from { opacity: 0; } to { opacity: 1; } }
[data-testid="tour-overlay"] button:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .tour-spot, .tour-card { transition: none !important; animation: none !important; }
}
`;
