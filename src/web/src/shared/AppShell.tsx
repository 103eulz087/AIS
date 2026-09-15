import type { CSSProperties } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canApproveApplications } from "@/shared/roles";
import type { MembershipApplicationQueueItem } from "@/shared/types";

/**
 * "Notices" covers both /announcements and /memos — announcements and memos are
 * distinct screens (numbering, immutability, urgency differ too much to share
 * one form), but the bottom nav only has room for four tabs on a one-handed
 * phone, so they share a single entry with a chip switcher inside each screen.
 */
const BASE_TABS = [
  // Home was reachable only via the "AIS" wordmark in the header — not discoverable
  // enough (members didn't realise it was a link), so it gets an explicit tab too.
  { to: "/", label: "Home", icon: "⌂" },
  // Corrective actions is reached from within the Members tab (see MemberDirectory's
  // own entry point), not a bottom-tab item of its own — discipline records are about
  // members. alsoMatch keeps the tab visually active while the member is on
  // /corrective-actions/*. Reading the list is open to every member — this entry is
  // NEVER gated on canWriteDiscipline, only the "file a new case" action within the
  // screen itself is.
  { to: "/members", label: "Members", icon: "☰", alsoMatch: ["/corrective-actions"] },
  { to: "/meetings", label: "Meetings", icon: "▤" },
  // Ledger is the tab's landing screen; Activities/Expenses/Donations are reached from
  // the chip switcher on that screen (and on each other), the same "Funds" grouping
  // Notices uses for Announcements/Memos below.
  { to: "/ledger", label: "Funds", icon: "₱", alsoMatch: ["/activities", "/expenses", "/donations"] },
  { to: "/announcements", label: "Notices", icon: "🔔", alsoMatch: ["/memos"] },
];

export function AppShell() {
  const { claims, signOut } = useAuth();
  const location = useLocation();
  const roles = claims?.roles ?? [];
  const canApprove = canApproveApplications(roles);

  // GET /api/membership-applications?statusId=1&take=1 — statusId=1 is PendingApproval
  // (see shared/types.ts's MEMBERSHIP_APPLICATION_STATUSES, the same reference-data GAP
  // as elsewhere in this codebase). take=1 because only the paged result's own `total`
  // is used here, never the row itself — a free badge count, not a second query shape.
  const pendingCount = useQuery({
    queryKey: ["applications-pending-count"],
    queryFn: () => api.get<Paged<MembershipApplicationQueueItem>>("/api/membership-applications?statusId=1&take=1"),
    enabled: canApprove,
    staleTime: 60_000,
  });

  const tabs = canApprove
    ? [...BASE_TABS, { to: "/applications", label: "Applications", icon: "📝" }]
    : BASE_TABS;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header style={{
        background: "var(--deep)", color: "var(--paper)", padding: "13px 16px",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          {/* The bottom nav intentionally has no 5th "Home" tab — four tabs is already
              the limit for a one-handed phone screen. This is the dashboard's entry
              point from anywhere in the app instead. */}
          <Link to="/" style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".05em",
                                 color: "inherit", textDecoration: "none" }}>AIS</Link>
          {/* ChapterName is a known backend gap today (AuthEndpoints.Me) — omit the row
              entirely rather than show "null" or an empty line. */}
          {claims?.chapterName && (
            <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 2 }}>{claims.chapterName}</div>
          )}
        </div>

        {claims && (
          <div style={{ flex: "none", textAlign: "right" }}>
            {/* The signed-in member's own name doubles as the entry point to his profile —
                deliberately not a 5th/6th bottom tab; four tabs is already the reasoned
                limit for a one-handed phone screen (see BASE_TABS above), and this header
                is otherwise idle space on every screen. */}
            <Link
              to="/profile"
              style={{
                display: "block", minHeight: 26, padding: "2px 2px 0", fontSize: 12.5,
                fontWeight: 600, color: "var(--brass-soft)", textDecoration: "none",
              }}
            >
              {claims.giftName}
            </Link>
            <button
              onClick={() => { void signOut(); }}
              style={{ minHeight: 26, padding: "0 2px", fontSize: 10.5, color: "var(--mute)" }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <main style={{ flex: 1, overflowY: "auto" }}><Outlet /></main>

      <nav style={{
        display: "grid", gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
        background: "var(--paper)", borderTop: "1px solid var(--line)",
        padding: "6px 0 max(10px, env(safe-area-inset-bottom))",
      }}>
        {tabs.map(t => {
          const alsoActive = ("alsoMatch" in t ? t.alsoMatch : undefined)
            ?.some(p => location.pathname.startsWith(p)) ?? false;
          const showBadge = t.to === "/applications" && (pendingCount.data?.total ?? 0) > 0;
          return (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} style={({ isActive }) => ({
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              textDecoration: "none", minHeight: "var(--tap)", justifyContent: "center",
              color: isActive || alsoActive ? "var(--ink)" : "var(--mute)", position: "relative",
            })}>
              <span style={{ fontSize: 17, position: "relative" }}>
                {t.icon}
                {showBadge && <span style={badgeStyle}>{pendingCount.data?.total}</span>}
              </span>
              <span style={{ fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
                             textTransform: "uppercase" }}>{t.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

const badgeStyle: CSSProperties = {
  position: "absolute", top: -6, right: -10, minWidth: 15, height: 15, borderRadius: 8,
  background: "var(--out)", color: "var(--paper)", fontSize: 9.5, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
  fontFamily: "var(--f-num)",
};
