import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/shared/auth";
import { useIsNarrow } from "./responsive";
import { TourProvider, useTour } from "@/shared/tour/TourProvider";
import { useTourAutoStart } from "@/shared/tour/useTourAutoStart";
import { PORTAL_TOUR_KEY, PORTAL_TOUR_VERSION } from "@/shared/tour/types";
import { buildPortalTourSteps, navTourTarget, PORTAL_LINK_STEP_PREFIX } from "./portalTour";
import { canManageAppSettings, canManageMemberAccounts, canReviewChapterRegistrations, canSearchMembersByJurisdiction, canViewCouncilStatistics, canViewPaymentReport, canViewPaymentTags } from "@/shared/roles";

/**
 * Council Portal chrome. Desktop-first, but usable on a phone browser per CLAUDE.md's own
 * Portal requirement ("many municipal councils have no office computer"). No chapter mark
 * anywhere (docs §7A.3 doesn't apply to the Portal — this is a council officer's own app,
 * not a chapter's).
 *
 * Layout (redesigned 2026-10-18; the old header was one flat row of up to 11 links):
 *  - Wide screens: a ~240px left sidebar — wordmark on top, links under four small section
 *    headings (Chapters, Members, Councils, Notices), gift name and "Sign out" pinned at
 *    the bottom — with the content column to its right.
 *  - Phones (< 900px): a slim top bar with a hamburger button and the wordmark. The SAME nav
 *    opens as a drawer over the page; picking a link, tapping the backdrop, the close
 *    button or pressing Escape closes it. The drawer is hidden with CSS, never unmounted,
 *    so every link stays in the DOM. On a phone each group heading is a button that folds
 *    its links away (only the group holding the current page starts open); on wide screens the
 *    groups are always open. Opening moves focus into the drawer, closing returns it to the
 *    hamburger, and the page behind does not scroll while the drawer is open.
 *  - A whole group, heading included, is dropped when none of its links are visible.
 *  - Links are NavLinks; a detail route (/portal/councils/:id) keeps its parent lit.
 *    "Payment tags" uses `end` because "Payment report" is its sibling under the same path.
 *
 * No council-switcher. Each screen still does its own coarse gate (a permission key for
 * the phase 1 screens below, a role for everything else) and shows a plain "you don't have
 * access" state to anyone it turns away, same reasoning as canExportIdCards' own doc
 * comment in shared/roles.ts. The rules below decide only what appears in the menu.
 *
 * Phase 1 "dynamic council office permissions" (2026-10-17): "Chapter registrations",
 * "Statistics" and "Members" are each gated on the caller's own permission key
 * (canReviewChapterRegistrations/canViewCouncilStatistics/canSearchMembersByJurisdiction,
 * each checked against claims.councilSeats — "Members" ALSO shown if
 * canManageMemberAccounts, still role-based, since a National CouncilAdmin needs this
 * link even on a council seat with no search permission granted).
 * "Payment tags" and "Payment report" moved out of the secretaryOnly list into the
 * permission grid too ("Payment tags" = canViewPaymentTags, MemberPaymentTag.Read; "Payment report" =
 * canViewPaymentReport, MemberPaymentTag.Report — both National-only, held by National's
 * President by default); they are no longer decided by role name at all.
 * "Office permissions" is shown to ANY signed-in member who holds at least one council
 * seat at all, whatever permissions that seat carries — everyone seated gets to see what
 * their own office can and cannot do, even an Auditor with nothing granted.
 *
 * The secretaryOnly narrowing below is reserved for PHASE 2 links ONLY — ID card export,
 * chapter holds, announcements, Councils registry — exactly the same
 * client decision as before (2026-10-06): a user seated ONLY as CouncilSecretary —
 * nowhere also seated CouncilAdmin — sees none of these, keeping that role confined to
 * the chapter-registration module end to end. It does not touch "Chapter
 * registrations"/"Statistics"/"Members", which follow the permission grid instead, so a
 * council's own President can grant or revoke Review/Statistics/MemberSearch to or from
 * the Secretary office independently of this nav rule. This is a nav-visibility narrowing
 * only — it does not revoke whatever those phase 2 screens' own role gates still allow a
 * Secretary; it just keeps them out of this user's menu. Coarse and role-name-only, same
 * "no per-scope claims" limitation every role-based policy in this app already has: a
 * member who is Secretary at one council AND CouncilAdmin at another still sees the full
 * phase 2 nav.
 */
export function PortalShell() {
  const { claims } = useAuth();
  // The welcome tour lives here so the menu can open its own drawer while the tour points into it.
  return <TourProvider memberId={claims?.memberId}><PortalShellInner /></TourProvider>;
}

function PortalShellInner() {
  const { claims, signOut } = useAuth();
  const tour = useTour();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const narrow = useIsNarrow();
  const { pathname } = useLocation();
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const roles = claims?.roles ?? [];
  const seats = claims?.councilSeats ?? [];
  const secretaryOnly = roles.includes("CouncilSecretary") && !roles.includes("CouncilAdmin");
  const showMembers = canSearchMembersByJurisdiction(seats) || canManageMemberAccounts(roles);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus into the drawer on open, back to the hamburger on close; lock page scroll meanwhile.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeBtn.current?.focus();
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
    if (wasOpen.current) { wasOpen.current = false; menuBtn.current?.focus(); }
  }, [open]);

  const groups: NavGroup[] = [
    {
      heading: "Chapters",
      links: [
        { to: "/portal/chapter-registrations", label: "Chapter registrations", show: canReviewChapterRegistrations(seats), icon: "doc" },
        { to: "/portal/chapter-holds", label: "Chapter holds", show: !secretaryOnly, icon: "pause" },
      ],
    },
    {
      heading: "Members",
      links: [
        { to: "/portal/members", label: "Members", show: showMembers, icon: "people" },
        { to: "/portal/id-card-export", label: "ID card export", show: !secretaryOnly, icon: "card" },
        { to: "/portal/member-payment-tags", label: "Payment tags", show: canViewPaymentTags(seats), icon: "tag", end: true },
        { to: "/portal/member-payment-tags/stats", label: "Payment report", show: canViewPaymentReport(seats), icon: "chart" },
      ],
    },
    {
      heading: "Councils",
      links: [
        { to: "/portal/councils", label: "Councils", show: !secretaryOnly, icon: "building" },
        { to: "/portal/council-permissions", label: "Office permissions", show: seats.length > 0, icon: "key" },
        { to: "/portal/statistics", label: "Statistics", show: canViewCouncilStatistics(seats), icon: "chart" },
      ],
    },
    {
      heading: "Notices",
      links: [
        { to: "/portal/announcements", label: "Announcements", show: !secretaryOnly, icon: "bell" },
      ],
    },
    {
      heading: "Settings",
      links: [
        { to: "/portal/settings", label: "App settings", show: canManageAppSettings(seats), icon: "gear" },
      ],
    },
  ];

  const close = () => setOpen(false);

  // Welcome tour. On a phone the links live in the drawer, so hold it open (every group
  // unfolded) while a menu-link step is showing; it closes by itself when the tour ends.
  const tourInDrawer = narrow && tour.active && (tour.currentStep?.id ?? "").startsWith(PORTAL_LINK_STEP_PREFIX);
  const drawerOpen = open || tourInDrawer;
  const buildTourSteps = () => buildPortalTourSteps({
    giftName: claims?.giftName,
    visibleLinks: new Set(groups.flatMap(g => g.links.filter(l => l.show).map(l => l.to))),
    canSettings: canManageAppSettings(seats),
  });
  useTourAutoStart({
    tourKey: PORTAL_TOUR_KEY, tourVersion: PORTAL_TOUR_VERSION, enabled: !!claims, buildSteps: buildTourSteps,
  });
  const replayTour = () => {
    setOpen(false);
    tour.start({ tourKey: PORTAL_TOUR_KEY, tourVersion: PORTAL_TOUR_VERSION, steps: buildTourSteps() });
  };

  return (
    <div className="pshell" style={{ minHeight: "100dvh" }}>
      <style>{shellCss}</style>

      <header className="pshell-bar">
        {claims && (
          <button type="button" ref={menuBtn} className="pshell-menubtn" aria-label="Open menu" data-tour="portal-menu-button" aria-expanded={open}
            aria-controls="portal-nav" onClick={() => setOpen(true)}>
            <Icon name="menu" size={24} />
          </button>
        )}
        <Link to="/portal/chapter-registrations" className="pshell-word" style={wordmarkStyle}>Skeptron Council Portal</Link>
      </header>

      <div className={"pshell-backdrop" + (drawerOpen ? " is-open" : "")} onClick={close} aria-hidden="true" />

      <aside aria-label="Menu" data-tour="portal-sidebar" className={"pshell-side" + (drawerOpen ? " is-open" : "")}>
        <div className="pshell-brand">
          <Link to="/portal/chapter-registrations" className="pshell-word" style={wordmarkStyle} onClick={close}>Skeptron Council Portal</Link>
          <button type="button" ref={closeBtn} className="pshell-close" onClick={close} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        {claims && (
          <nav id="portal-nav" aria-label="Portal" className="pshell-nav">
            {groups.map(g => {
              const visible = g.links.filter(l => l.show);
              if (visible.length === 0) return null;
              const holdsPage = visible.some(l => pathname === l.to || pathname.startsWith(l.to + "/"));
              // Folded only on a phone. Starts folded except the group holding the current page; a tap overrides.
              const folded = narrow && !tourInDrawer && (collapsed[g.heading] ?? !holdsPage);
              const listId = "pnav-" + g.heading.toLowerCase();
              return (
                <section key={g.heading} aria-label={g.heading}>
                  <h2 className="pshell-h">
                    {narrow ? (
                      <button type="button" className="pshell-hbtn" aria-expanded={!folded} aria-controls={listId}
                        onClick={() => setCollapsed(c => ({ ...c, [g.heading]: !folded }))}>
                        <span>{g.heading}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                          style={{ transform: folded ? "none" : "rotate(180deg)", transition: "transform .15s" }}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    ) : g.heading}
                  </h2>
                  <div id={listId} hidden={folded}>
                  {visible.map(l => (
                    <NavLink key={l.to} to={l.to} end={l.end} className="pshell-link" onClick={close} data-tour={navTourTarget(l.to)}>
                      <Icon name={l.icon} />
                      <span>{l.label}</span>
                    </NavLink>
                  ))}
                  </div>
                </section>
              );
            })}
          </nav>
        )}

        {claims && (
          <div style={{ padding: "8px 16px 0" }}>
            <button type="button" className="pshell-signout" style={{ width: "100%" }} onClick={replayTour}>
              Take the tour
            </button>
            {/* Council officers are chapter members too; without this the member app (and its
                own first-login tour, which starts on its Home) is only reachable by typing "/". */}
            {claims.chapterId > 0 && (
              <Link to="/" className="pshell-signout" onClick={close} style={memberAppLinkStyle}>
                Open the member app
              </Link>
            )}
          </div>
        )}

        {claims && (
          <div className="pshell-foot">
            <span style={{ fontSize: 13, color: "var(--brass-soft)", overflowWrap: "anywhere" }}>{claims.giftName}</span>
            <button type="button" className="pshell-signout" onClick={() => { void signOut(); }}>Sign out</button>
          </div>
        )}
      </aside>

      <main className="pshell-main">
        <div className="pshell-content" style={contentStyle}><Outlet /></div>
      </main>
    </div>
  );
}

interface NavLinkDef { to: string; label: string; show: boolean; icon: IconName; end?: boolean }
interface NavGroup { heading: string; links: NavLinkDef[] }

type IconName = "menu" | "close" | "doc" | "pause" | "people" | "card" | "tag" | "chart" | "building" | "key" | "bell" | "gear";

const ICON_PATHS: Record<IconName, ReactNode> = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  pause: <><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 6.5a3 3 0 010 5.5M18 14.5c1.8.8 3 2.6 3 5.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 13h4" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>,
  chart: <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" />,
  building: <path d="M4 21h16M6 21V9l6-5 6 5v12M10 21v-5h4v5M9 12h1M14 12h1" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
  bell: <path d="M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      {ICON_PATHS[name]}
    </svg>
  );
}

const wordmarkStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 19, letterSpacing: ".05em",
  color: "inherit", textDecoration: "none",
};

const memberAppLinkStyle: CSSProperties = {
  width: "100%", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none",
};

const contentStyle: CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "24px 20px 60px", minWidth: 0 };

/** Scoped to .pshell. Media queries and :hover/:focus-visible can't live in inline styles. */
const shellCss = `
.pshell { display: flex; flex-direction: column; }
.pshell-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  background: var(--deep); color: var(--paper); padding: 0 16px; min-height: 56px; }
.pshell-bar { justify-content: flex-start; padding: 0 8px; }
.pshell-menubtn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--tap); min-width: var(--tap);
  color: var(--paper); border-radius: var(--r); background: transparent; }
.pshell-word { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pshell-hbtn { display: flex; width: 100%; align-items: center; justify-content: space-between; min-height: var(--tap);
  padding: 0 8px; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; background: transparent; }
.pshell-hbtn:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.pshell-content { padding: 20px 16px 48px !important; }
@media (prefers-reduced-motion: reduce) { .pshell-side { transition: none !important; } .pshell-hbtn svg { transition: none !important; } }
.pshell-backdrop { display: none; }
.pshell-side { position: fixed; top: 0; bottom: 0; left: 0; width: min(300px, 86vw); z-index: 30;
  background: var(--deep); color: var(--paper); display: flex; flex-direction: column;
  transform: translateX(-100%); visibility: hidden; transition: transform .18s ease, visibility .18s; overflow-y: auto; }
.pshell-side.is-open { transform: none; visibility: visible; }
.pshell-backdrop.is-open { display: block; position: fixed; inset: 0; z-index: 20; background: rgba(14,17,22,.55); }
.pshell-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px 0 16px; min-height: 56px; }
.pshell-close { display: inline-flex; align-items: center; justify-content: center; min-width: var(--tap); min-height: var(--tap);
  color: var(--paper); background: transparent; }
.pshell-nav { flex: 1; padding: 4px 12px 16px; }
.pshell-h { margin: 6px 0 0; font: 600 11px var(--f-body); letter-spacing: .12em; text-transform: uppercase; color: var(--mute); }
.pshell-link { display: flex; align-items: center; gap: 10px; min-height: var(--tap); padding: 0 12px; border-radius: 8px;
  color: var(--paper); text-decoration: none; font-size: 14px; border-left: 3px solid transparent; }
.pshell-link:hover { background: var(--slate); }
.pshell-link:focus-visible, .pshell-signout:focus-visible, .pshell-menubtn:focus-visible, .pshell-close:focus-visible {
  outline: 2px solid var(--brass); outline-offset: 2px; }
.pshell-link.active { background: var(--slate); border-left-color: var(--brass); color: var(--brass-soft); font-weight: 600; }
.pshell-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--slate); }
.pshell-signout { min-height: var(--tap); padding: 0 12px; font-size: 13px; color: var(--paper); background: transparent;
  border: 1px solid var(--slate); border-radius: 8px; }
.pshell-signout:hover { background: var(--slate); }
.pshell-main { flex: 1; min-width: 0; }
@media (min-width: 900px) {
  .pshell { flex-direction: row; }
  .pshell-bar, .pshell-backdrop, .pshell-close { display: none !important; }
  .pshell-side { position: sticky; top: 0; height: 100dvh; width: 240px; flex: none; transform: none; visibility: visible; transition: none; }
  .pshell-brand { padding: 0 16px; min-height: 64px; }
  .pshell-h { margin: 18px 8px 6px; }
  .pshell-content { padding: 24px 20px 60px !important; }
}
`;
