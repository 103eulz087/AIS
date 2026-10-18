import type { CSSProperties } from "react";

/**
 * Shared dark/emerald palette for the Digital ID card (DigitalId.tsx) and the public
 * verification page (VerifyCard.tsx) — deliberately scoped to these two screens only,
 * matching the front.png/back.png ID card template the client supplied 2026-09-29. Every
 * other screen in the app keeps the existing navy/brass identity from tokens.css; this is
 * NOT a global palette change.
 */
export const ID_CARD = {
  bg: "linear-gradient(160deg, #131C17 0%, #0B120E 55%, #050805 100%)",
  border: "rgba(46, 216, 160, .22)",
  accent: "#2ED8A0",
  accentDim: "#1B7A5C",
  accentSoft: "#BFF3DE",
  white: "#FFFFFF",
  muted: "#8FA79C",
  footerBg: "linear-gradient(90deg, #123527 0%, #08150F 100%)",
} as const;

/**
 * A diagonal, non-interactive "NOT YET PAID" stamp — the standalone payment tag's only
 * visual effect on either screen (client decision 2026-09-29: watermark, never a block on
 * access). Renders nothing when isPaid.
 */
export function NotPaidWatermark({ isPaid }: { isPaid: boolean }) {
  if (isPaid) return null;
  return (
    <div style={watermarkWrapStyle} aria-hidden="true">
      <span style={watermarkTextStyle}>NOT YET PAID</span>
    </div>
  );
}

const watermarkWrapStyle: CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center",
  pointerEvents: "none", overflow: "hidden", zIndex: 5,
};

const watermarkTextStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 26, fontWeight: 700, letterSpacing: ".08em",
  color: "rgba(224, 82, 63, .78)", border: "3px solid rgba(224, 82, 63, .78)",
  padding: "4px 18px", borderRadius: 6, transform: "rotate(-16deg)",
  textShadow: "0 1px 3px rgba(0,0,0,.5)", whiteSpace: "nowrap",
};
