import { Link } from "react-router-dom";
import type { CSSProperties } from "react";

/**
 * The chip switcher shared by the four Funds screens (Ledger, Activities, Expenses,
 * Donations) — same pattern as the Announcements/Memos switcher in AnnouncementList/
 * MemoList. There is no separate top-level nav tab for each; the bottom nav's single
 * "Funds" tab lands on the ledger, and this row is how the other three are reached.
 */
export function FundsTabs({ active }: { active: "ledger" | "activities" | "expenses" | "donations" }) {
  const tabs: Array<{ key: typeof active; to: string; label: string }> = [
    { key: "ledger", to: "/ledger", label: "Ledger" },
    { key: "activities", to: "/activities", label: "Activities" },
    { key: "expenses", to: "/expenses", label: "Expenses" },
    { key: "donations", to: "/donations", label: "Donations" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, padding: "12px 16px 0", flexWrap: "wrap" }}>
      {tabs.map(t => t.key === active
        ? <span key={t.key} style={chipOnStyle}>{t.label}</span>
        : <Link key={t.key} to={t.to} style={chipStyle}>{t.label}</Link>)}
    </div>
  );
}

const chipBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 30, padding: "0 12px",
  borderRadius: 16, fontSize: 12.5, textDecoration: "none",
};

const chipStyle: CSSProperties = {
  ...chipBase, border: "1px solid var(--line)", color: "var(--slate)", background: "var(--paper)",
};

const chipOnStyle: CSSProperties = {
  ...chipBase, background: "var(--deep)", color: "var(--brass-soft)",
};
