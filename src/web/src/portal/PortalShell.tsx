import type { CSSProperties } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "@/shared/auth";

/**
 * Minimal Council Portal chrome. This is the FIRST Portal-side screen built in this
 * codebase — there was no existing /portal route, layout or shell to extend, so this is
 * a judgment call rather than an established pattern: a plain, desktop-first top bar
 * (wide content column, no bottom tab bar — that pattern belongs to AIS's one-handed
 * phone layout, not to a council officer's desk) that still renders usably on a phone
 * browser per CLAUDE.md's own Portal requirement ("many municipal councils have no
 * office computer"). No chapter mark anywhere (docs §7A.3 doesn't apply to the Portal at
 * all — this is a council officer's own app, not a chapter's).
 *
 * Deliberately no council-switcher, no sidebar: this header nav is a flat list of plain
 * links, extended in place as each Portal module ships (chapter registrations, then the
 * National ID card export) rather than each module building its own chrome. Every link
 * here is visible to any signed-in council officer — each screen does its own coarse
 * role gate and shows a plain "you don't have access" state to anyone it turns away,
 * same reasoning as canExportIdCards' own doc comment in shared/roles.ts.
 */
export function PortalShell() {
  const { claims, signOut } = useAuth();

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={headerStyle}>
        <div style={headerInnerStyle}>
          <Link to="/portal/chapter-registrations" style={wordmarkStyle}>Skeptron Council Portal</Link>

          {claims && (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Link to="/portal/chapter-registrations" style={navLinkStyle}>Chapter registrations</Link>
              <Link to="/portal/id-card-export" style={navLinkStyle}>ID card export</Link>
              <Link to="/portal/statistics" style={navLinkStyle}>Statistics</Link>
              <Link to="/portal/blocked-members" style={navLinkStyle}>Blocked members</Link>
              <Link to="/portal/councils" style={navLinkStyle}>Councils</Link>
              <span style={{ fontSize: 13, color: "var(--brass-soft)" }}>{claims.giftName}</span>
              <button onClick={() => { void signOut(); }} style={signOutStyle}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1 }}>
        <div style={contentStyle}><Outlet /></div>
      </main>
    </div>
  );
}

const headerStyle: CSSProperties = { background: "var(--deep)", color: "var(--paper)" };

const headerInnerStyle: CSSProperties = {
  maxWidth: 1100, margin: "0 auto", padding: "14px 20px",
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
};

const wordmarkStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 19, letterSpacing: ".05em",
  color: "inherit", textDecoration: "none",
};

const signOutStyle: CSSProperties = { minHeight: 36, padding: "0 4px", fontSize: 12.5, color: "var(--mute)" };

const navLinkStyle: CSSProperties = {
  fontSize: 13, color: "var(--paper)", textDecoration: "none", minHeight: 36, display: "flex", alignItems: "center",
};

const contentStyle: CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "24px 20px 60px" };
