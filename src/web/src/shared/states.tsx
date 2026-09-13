import type { ReactNode } from "react";

/**
 * The three states every screen needs before its happy path.
 * Write the empty state FIRST — it is what a brand-new chapter sees for its first week,
 * and it is the state most often shipped broken.
 */

export function ScreenSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 16 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{
          height: 62, marginBottom: 10, borderRadius: "var(--r)",
          background: "var(--paper)", border: "1px solid var(--line)", opacity: 0.6,
        }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: {
  title: string; body: string; action?: ReactNode;
}) {
  return (
    <div style={{ padding: "48px 30px", textAlign: "center", color: "var(--mute)" }}>
      <p style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".04em",
                  color: "var(--ink)", marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>{body}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: "40px 30px", textAlign: "center" }}>
      <p style={{ fontFamily: "var(--f-disp)", fontSize: 19, color: "var(--out)" }}>
        That did not load
      </p>
      <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
        {message ?? "Check your connection and try again."}
      </p>
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: 16, padding: "10px 20px", borderRadius: 8,
          background: "var(--deep)", color: "var(--paper)",
          fontFamily: "var(--f-disp)", letterSpacing: ".1em", textTransform: "uppercase",
        }}>Try again</button>
      )}
    </div>
  );
}
