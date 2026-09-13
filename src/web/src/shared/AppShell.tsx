import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/members", label: "Members", icon: "☰" },
  { to: "/ledger", label: "Funds", icon: "₱" },
];

export function AppShell() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header style={{ background: "var(--deep)", color: "var(--paper)", padding: "13px 16px" }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".05em" }}>AIS</div>
        <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 2 }}>
          Brgy. San Isidro Chapter
        </div>
      </header>

      <main style={{ flex: 1, overflowY: "auto" }}><Outlet /></main>

      <nav style={{
        display: "grid", gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        background: "var(--paper)", borderTop: "1px solid var(--line)",
        padding: "6px 0 max(10px, env(safe-area-inset-bottom))",
      }}>
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} style={({ isActive }) => ({
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            textDecoration: "none", minHeight: "var(--tap)", justifyContent: "center",
            color: isActive ? "var(--ink)" : "var(--mute)",
          })}>
            <span style={{ fontSize: 17 }}>{t.icon}</span>
            <span style={{ fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
                           textTransform: "uppercase" }}>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
