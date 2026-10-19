import { createContext } from "react";
import type { TourStep } from "@/shared/tour/types";
import { BadgeSketch, IconBadge, Pic, PhoneFrame, SketchButton, SketchLine, SketchRow, StepStrip } from "@/shared/tour/illustrations";

/** Lets the Help page (a child of the shell) replay the welcome tour, which only the shell can build. */
export const PortalWelcomeContext = createContext<(() => void) | null>(null);

/** Tour target for a Portal nav link, from its path: "/portal/council-permissions" -> "nav-council-permissions". */
export function navTourTarget(to: string): string {
  return "nav-" + to.replace(/^\/portal\//, "").replace(/\//g, "-");
}

/** Step ids that point at a link inside the menu. On a phone the menu is a drawer that must be open for these. */
export const PORTAL_LINK_STEP_PREFIX = "link-";

interface PortalTourInput {
  giftName: string | undefined;
  /** The `to` paths of the nav links this user can actually see (the same list the menu draws). */
  visibleLinks: ReadonlySet<string>;
  canSettings: boolean;
}

const LINK_STEPS: Array<{ to: string; title: string; body: string }> = [
  {
    to: "/portal/chapter-registrations", title: "Chapter registrations",
    body: "New chapters waiting for your council's review and approval are listed here.",
  },
  {
    to: "/portal/members", title: "Members",
    body: "Look up members across your jurisdiction by name, chapter or status.",
  },
  {
    to: "/portal/councils", title: "Councils",
    body: "The councils in your jurisdiction, and the officers seated in each.",
  },
  {
    to: "/portal/council-permissions", title: "Office permissions",
    body: "See what each office in your council can do. Presidents can adjust this for their own council.",
  },
  {
    to: "/portal/statistics", title: "Statistics",
    body: "Numbers for your jurisdiction: chapters, members and how renewals are going.",
  },
  {
    to: "/portal/settings", title: "App settings",
    body: "Settings that apply to the whole app, such as the free trial for members.",
  },
];

/**
 * The Council Portal welcome tour (tourKey "portal-welcome"). Only links the user can really
 * see in the menu get a step, so nobody is shown a door that isn't theirs.
 * On a phone the menu steps point at the hamburger first; the link steps then hold the drawer
 * open (PortalShell does that while a "link-" step is showing).
 */
export function buildPortalTourSteps({ giftName, visibleLinks, canSettings }: PortalTourInput): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      title: giftName ? `Welcome, ${giftName}!` : "Welcome!",
      body: "The Council Portal is where councils approve chapters, manage officers and see their jurisdiction. Here is a short tour of the menu.",
      illustration: <Pic><IconBadge kind="book" /><StepStrip steps={["Menu", "Pick a page", "Do the work"]} active={0} /></Pic>,
    },
    {
      id: "menu-phone", target: "portal-menu-button", when: env => env.narrow,
      title: "The menu",
      body: "Tap this button to open the menu. Everything in the Portal is reached from there. Next, a look at what is inside.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 2, top: 2, width: 22, height: 16 }}>
            <SketchLine w="60%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "menu-desktop", target: "portal-sidebar", when: env => !env.narrow,
      title: "The menu",
      body: "Everything in the Portal is reached from this menu, grouped by what you are doing. You will only see what your office can use.",
    },
  ];

  for (const l of LINK_STEPS) {
    if (!visibleLinks.has(l.to)) continue;
    if (l.to === "/portal/settings" && !canSettings) continue;
    steps.push({ id: PORTAL_LINK_STEP_PREFIX + navTourTarget(l.to), target: navTourTarget(l.to), title: l.title, body: l.body });
  }

  // Everyone with a menu has Help & guides, so this step is never filtered. It sits in the
  // menu's footer (the "link-" prefix keeps the phone drawer open for it).
  steps.push({
    id: PORTAL_LINK_STEP_PREFIX + "nav-help", target: "nav-help",
    title: "Want to learn how to do things?",
    body: "Help & guides has step-by-step walk-throughs on the real screens. Pick one and we will show you where to tap.",
    illustration: <Pic><SketchButton>HELP &amp; GUIDES</SketchButton><BadgeSketch tone="ok">{"\u2713"} Done</BadgeSketch></Pic>,
  });

  steps.push({
    id: "done",
    title: "You're all set!",
    body: "You can take this tour again anytime. Look for “Take the tour” at the bottom of the menu.",
    illustration: <Pic><IconBadge kind="check" /></Pic>,
  });
  return steps;
}
