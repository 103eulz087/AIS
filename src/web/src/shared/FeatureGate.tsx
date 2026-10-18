import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMemberAccess } from "@/shared/memberAccess";

/**
 * Wraps a gated AIS route. Open (or still loading, or access unreadable) renders the
 * screen untouched; closed renders a kind, neutral explanation instead. Being locked
 * is about the free trial only — never a judgement, never an amount owed.
 */
export function FeatureGate({ featureKey, children }: { featureKey: string; children: ReactNode }) {
  const { isFeatureOpen } = useMemberAccess();
  if (isFeatureOpen(featureKey)) return <>{children}</>;
  return <TrialEndedNotice />;
}

export function TrialEndedNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div role="status" style={{
      padding: compact ? "14px 16px" : "48px 30px", textAlign: "center",
      ...(compact ? {
        margin: "12px 16px 4px", borderRadius: "var(--r)", background: "var(--paper)",
        border: "1px solid var(--line)", textAlign: "left" as const,
      } : {}),
    }}>
      <p style={{ fontFamily: "var(--f-disp)", fontSize: compact ? 17 : 22, letterSpacing: ".03em", color: "var(--ink)" }}>
        Your free trial has ended
      </p>
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--slate)", marginTop: 8 }}>
        You can still read announcements. The rest of the app opens again once your membership
        payment for this year is recorded by the National Council.
      </p>
      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--mute)", marginTop: 6 }}>
        Your profile, password and notification settings are always available.
      </p>
      <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: compact ? "flex-start" : "center", flexWrap: "wrap" }}>
        <Link to="/announcements" style={primaryLink}>Read announcements</Link>
        <Link to="/profile" style={secondaryLink}>My profile</Link>
      </div>
    </div>
  );
}

const linkBase = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "var(--tap)",
  padding: "0 18px", borderRadius: 8, textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
} as const;
const primaryLink = { ...linkBase, background: "var(--deep)", color: "var(--brass-soft)" } as const;
const secondaryLink = { ...linkBase, border: "1px solid var(--line)", color: "var(--ink)", background: "var(--paper)" } as const;
