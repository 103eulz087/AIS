import type { CSSProperties, ReactNode } from "react";

/**
 * Small built-in pictures for tour and guide steps. No image files: CSS and inline SVG in the
 * app's own colours, so they cost nothing to download and stay sharp on any phone.
 *
 * Rules for pieces added here
 *  - Decorative only: everything is aria-hidden (the step's title and body carry the meaning).
 *  - Small: the card shows them in a box at most 120px tall on a phone (170px on a desktop).
 *    Aim for roughly 96px tall and under 260px wide.
 *  - Token colours only (var(--ink), var(--brass)...). Brass means "look here".
 *  - Never put a made-up amount or a name that looks real in a picture. Money goes through peso().
 *
 * Compose them like this:
 *   <Pic>
 *     <PhoneFrame highlight={{ left: 8, top: 62, width: 84, height: 24 }}>
 *       <SketchLine w="60%" /><SketchButton>+ New meeting</SketchButton>
 *     </PhoneFrame>
 *   </Pic>
 */

/** Keyframes for the pieces below. Included once by TourOverlay, so a picture is just markup. */
export const ILLUS_CSS = `
.illus-pulse { animation: illus-pulse 1.4s ease-in-out infinite; }
.illus-tap { animation: illus-tap 1.4s ease-in-out infinite; }
@keyframes illus-pulse { 0% { transform: scale(.7); opacity: .9; } 70%, 100% { transform: scale(1.5); opacity: 0; } }
@keyframes illus-tap { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-3px, -3px); } }
@media (prefers-reduced-motion: reduce) {
  .illus-pulse, .illus-tap { animation: none !important; }
  .illus-pulse { opacity: .35; transform: scale(1.2); }
}
`;

/** Wrapper that carries the shared styles (animation) and hides the whole picture from screen readers. */
export function Pic({ children, gap = 10, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  return (
    <div aria-hidden="true" style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap, flexWrap: "nowrap",
      maxWidth: "100%", maxHeight: "100%", ...style,
    }}>
      {children}
    </div>
  );
}

export interface Region { left: number; top: number; width: number; height: number }

/**
 * A pretend phone screen. `highlight` is a brass outline in PERCENT of the screen
 * ({ left, top, width, height }), with a pulsing TapHint in its corner unless tap={false}.
 */
export function PhoneFrame({ children, highlight, tap = true, width = 132, height = 100 }: {
  children?: ReactNode; highlight?: Region; tap?: boolean; width?: number; height?: number;
}) {
  return (
    <div aria-hidden="true" style={{
      position: "relative", flex: "none", width, height, boxSizing: "border-box", overflow: "hidden",
      background: "var(--paper)", border: "2px solid var(--ink)", borderRadius: 14,
      boxShadow: "0 2px 0 rgba(14,17,22,.12)",
    }}>
      <div style={{ height: 14, background: "var(--deep)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 26, height: 4, borderRadius: 2, background: "var(--slate)" }} />
      </div>
      <div style={{ padding: "7px 8px", display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
      {highlight && (
        <>
          <span style={{
            position: "absolute", left: `${highlight.left}%`, top: `${highlight.top}%`,
            width: `${highlight.width}%`, height: `${highlight.height}%`, boxSizing: "border-box",
            border: "2px solid var(--brass)", borderRadius: 6, boxShadow: "0 0 0 100px rgba(14,17,22,.10)",
          }} />
          {tap && (
            <span style={{
              position: "absolute", left: `${highlight.left + highlight.width * 0.62}%`, top: `${highlight.top + highlight.height * 0.45}%`,
            }}>
              <TapHint size={20} />
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** A grey bar standing in for a line of text. */
export function SketchLine({ w = "100%", strong = false }: { w?: string | number; strong?: boolean }) {
  return <span style={{ display: "block", height: strong ? 7 : 5, width: w, borderRadius: 3, background: strong ? "var(--slate)" : "var(--line)" }} />;
}

/** A button inside a PhoneFrame or FieldSketch scene. */
export function SketchButton({ children, tone = "dark" }: { children?: ReactNode; tone?: "dark" | "light" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", height: 18, padding: "0 8px",
      borderRadius: 5, fontSize: 9, fontWeight: 600, letterSpacing: ".03em", whiteSpace: "nowrap", alignSelf: "flex-start",
      background: tone === "dark" ? "var(--deep)" : "var(--paper)",
      color: tone === "dark" ? "var(--brass-soft)" : "var(--ink)",
      border: tone === "dark" ? "1px solid var(--deep)" : "1px solid var(--line)",
    }}>{children}</span>
  );
}

/** A list row: a name bar on the left, a little pill on the right. */
export function SketchRow({ pill }: { pill?: ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, height: 16, borderBottom: "1px solid var(--line)" }}>
      <span style={{ flex: 1 }}><SketchLine w="70%" /></span>
      {pill}
    </span>
  );
}

/** A pulsing dot with a little finger-tap nudge: "tap here". Static when the phone asks for less motion. */
export function TapHint({ size = 26 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ position: "relative", display: "inline-block", width: size, height: size, flex: "none" }}>
      <span className="illus-pulse" style={{
        position: "absolute", inset: 0, borderRadius: "50%", background: "var(--brass)", opacity: 0.5,
      }} />
      <span className="illus-tap" style={{
        position: "absolute", left: "30%", top: "30%", width: "40%", height: "40%", borderRadius: "50%",
        background: "var(--brass)", border: "2px solid var(--paper)", boxShadow: "0 1px 3px rgba(14,17,22,.4)",
      }} />
    </span>
  );
}

/**
 * "Open > Fill in > Save": the steps of a job, one lit. Wraps on a narrow card. `active` is 0-based;
 * earlier ones show as done.
 */
export function StepStrip({ steps, active = 0 }: { steps: readonly string[]; active?: number }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", justifyContent: "center", gap: "4px 2px", maxWidth: "100%" }}>
      {steps.map((label, i) => {
        const on = i === active;
        const done = i < active;
        return (
          <span key={label + i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px 0 4px", borderRadius: 12,
              fontSize: 11.5, fontWeight: on ? 700 : 500, whiteSpace: "nowrap",
              background: on ? "var(--deep)" : "var(--paper)", color: on ? "var(--brass-soft)" : done ? "var(--slate)" : "var(--mute)",
              border: `1px solid ${on ? "var(--deep)" : "var(--line)"}`,
            }}>
              <span className="num" style={{
                width: 16, height: 16, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, background: on ? "var(--brass)" : done ? "var(--in)" : "var(--bond)", color: on || done ? "var(--paper)" : "var(--mute)",
              }}>{done ? "✓" : i + 1}</span>
              {label}
            </span>
            {i < steps.length - 1 && <span style={{ color: "var(--mute)", fontSize: 11 }}>{"›"}</span>}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A form field: the label above a box. `kind` changes the little icon on the right.
 * `hint` shows grey example text; `value` shows filled-in text. `highlight` rings it in brass.
 */
export function FieldSketch({ label, value, hint, kind = "text", highlight = false, width = 200 }: {
  label: string; value?: string; hint?: string; kind?: "text" | "date" | "select" | "textarea";
  highlight?: boolean; width?: number | string;
}) {
  const tall = kind === "textarea";
  return (
    <span aria-hidden="true" style={{ display: "block", width, maxWidth: "100%" }}>
      <span style={{ display: "block", fontSize: 10.5, color: "var(--slate)", marginBottom: 3 }}>{label}</span>
      <span style={{
        display: "flex", alignItems: tall ? "flex-start" : "center", justifyContent: "space-between", gap: 6,
        height: tall ? 38 : 26, padding: "0 8px", paddingTop: tall ? 6 : 0, boxSizing: "border-box", borderRadius: 6,
        background: "var(--paper)", fontSize: 11.5, color: value ? "var(--ink)" : "var(--mute)",
        border: highlight ? "2px solid var(--brass)" : "1px solid var(--line)",
        boxShadow: highlight ? "0 0 0 3px rgba(195,154,62,.25)" : "none",
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value ?? hint ?? ""}</span>
        {kind === "date" && <CalendarGlyph />}
        {kind === "select" && <span style={{ fontSize: 9, color: "var(--mute)" }}>{"▾"}</span>}
      </span>
    </span>
  );
}

function CalendarGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mute)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export type BadgeTone = "ok" | "warn" | "info" | "neutral" | "danger" | "brass";

const BADGE_TONES: Record<BadgeTone, CSSProperties> = {
  ok: { background: "var(--bond)", color: "var(--in)", border: "1px solid var(--line)" },
  warn: { background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8" },
  info: { background: "var(--bond)", color: "var(--info)", border: "1px solid var(--line)" },
  neutral: { background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)" },
  danger: { background: "var(--bond)", color: "var(--out)", border: "1px solid var(--line)" },
  brass: { background: "var(--deep)", color: "var(--brass-soft)", border: "1px solid var(--deep)" },
};

/** A status pill like the ones on the real screens ("Draft", "Verified", "Returned"). */
export function BadgeSketch({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", fontSize: 10.5, padding: "2px 9px", borderRadius: 10, whiteSpace: "nowrap", ...BADGE_TONES[tone],
    }}>{children}</span>
  );
}

/** A big arrow between two pictures ("this becomes that"). */
export function ArrowRight() {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="var(--brass)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M2 7h16M13 2l6 5-6 5" />
    </svg>
  );
}

/** A round icon in a circle: a handy centrepiece for a welcome card. `kind` picks the glyph. */
export function IconBadge({ kind, tone = "brass" }: { kind: "check" | "book" | "people" | "money" | "lock" | "bell" | "card"; tone?: "brass" | "ink" }) {
  const bg = tone === "brass" ? "var(--brass)" : "var(--deep)";
  const paths: Record<string, ReactNode> = {
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    book: <path d="M4 5.5A2 2 0 0 1 6 4h12v15H6a2 2 0 0 0-2 2zM4 19.5V5.5M8 8h7" />,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 6.5a3 3 0 0 1 0 5.5M18 14.5c2 .8 3 2.6 3 5.5" /></>,
    money: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5v9M9.5 10c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.6-2.5 1.8-2.5.8-2.5 1.8 1 1.8 2.5 1.8 2.5-.8 2.5-1.8" /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
    card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  };
  return (
    <span aria-hidden="true" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: "50%", background: bg, flex: "none",
    }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind]}
      </svg>
    </span>
  );
}

/** A caption under a picture, in the card's small grey type. */
export function PicCaption({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" style={{ fontSize: 11, color: "var(--mute)", lineHeight: 1.3, maxWidth: 110 }}>{children}</span>;
}
