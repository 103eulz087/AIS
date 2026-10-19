import { api } from "@/shared/api";
import { canSeatCouncilOfficers } from "@/shared/roles";
import { COUNCIL_OFFICES, type CouncilRegistry, type CouncilRoster } from "@/shared/types";
import { lazyOnce, type GuideDefinition } from "@/shared/tour/guides";
import {
  ArrowRight, BadgeSketch, FieldSketch, IconBadge, Pic, SketchButton, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-portal-seating — "Seat or unseat a council officer".
 *
 * One lookup (lazyOnce) walks the caller's own councils for (a) one with a vacant office to
 * show "Seat someone" and (b) one with a seated officer to show "Unseat". A step with nothing
 * to show is dropped; the explaining steps carry the message either way. The seating panel
 * itself only opens when "Seat someone" is pressed, and the tour never presses, so those steps
 * describe it with pictures instead of pointing at it. Nothing is ever submitted.
 *
 * Targets (data-tour): CouncilRegistry (council-crumbs, council-state, council-child-first,
 * council-manage-link); CouncilRoster (roster-officers, roster-seat-first, roster-unseat-first).
 */
interface Found { vacant: string | null; seated: string | null }
const MAX_LOOKED_AT = 6;

async function lookUp(): Promise<Found> {
  const rows = await api.get<CouncilRegistry[]>("/api/councils");
  const out: Found = { vacant: null, seated: null };
  for (const c of (rows ?? []).filter(r => !r.isDissolved).slice(0, MAX_LOOKED_AT)) {
    if (out.vacant && out.seated) break;
    const path = `/portal/councils/${c.councilId}`;
    const r = await api.get<CouncilRoster>(`/api/councils/${c.councilId}/officers`);
    const current = (r.seats ?? []).filter(s => s.isCurrent);
    if (!out.seated && current.length > 0) out.seated = path;
    if (!out.vacant && COUNCIL_OFFICES.some(o => !current.some(s => s.councilOfficeId === o.councilOfficeId))) out.vacant = path;
  }
  return out;
}

export function buildSeatingGuideSteps(_ctx: GuideContext): TourStep[] {
  const found = lazyOnce(lookUp);
  const pick = (k: keyof Found) => async () => (await found())?.[k] ?? null;
  const REGISTRY = "/portal/councils";
  const wait = 6000;

  return [
    {
      id: "intro",
      title: "Seating a council officer",
      body: "A council needs its officers seated before it can approve anything. We will walk through choosing a brother for an office. Nothing is changed while the guide runs.",
      illustration: <Pic><StepStrip steps={["Pick council", "Seat", "Send link"]} active={0} /></Pic>,
    },
    {
      id: "registry", route: REGISTRY, target: "council-state", waitMs: wait,
      title: "The Council registry",
      body: "This is your council: its level, whether officers are seated, and how many chapters and members sit beneath it.",
      illustration: <Pic gap={6}><BadgeSketch tone="ok">Seated</BadgeSketch><BadgeSketch tone="warn">Not yet constituted</BadgeSketch><BadgeSketch tone="danger">Dormant</BadgeSketch></Pic>,
    },
    {
      id: "child", route: REGISTRY, target: "council-child-first", waitMs: wait,
      title: "Go down to a council beneath yours",
      body: "Tap a council name in the list to move into it. The trail above the card shows where you are, and you can tap any name there to go back up.",
      tip: "No list here means no council has been created beneath yours yet.",
    },
    {
      id: "manage", route: REGISTRY, target: "council-manage-link", waitMs: wait,
      title: "View / manage officers",
      body: "Open the council's roster from here. We will open one that has something to show.",
    },
    {
      id: "roster", route: pick("vacant"), target: "roster-officers", waitMs: wait,
      title: "One card for every office",
      body: "Each office shows who holds it, since when, and whether he has an account yet. An empty office plainly says Vacant.",
    },
    {
      id: "seat", route: pick("vacant"), target: "roster-seat-first", waitMs: wait,
      title: "Seat someone",
      body: "On a vacant office, Seat someone opens the seating panel. We will not press it for you. The next steps describe what you will see.",
      illustration: <Pic><SketchButton tone="light">SEAT SOMEONE</SketchButton></Pic>,
    },
    {
      id: "this-jurisdiction",
      title: "From this jurisdiction",
      body: "The first tab lists members of this council's own area. Type a name to narrow the list. A candidate whose renewal has lapsed, or who has no mobile number, is marked before you choose him.",
      illustration: <Pic><FieldSketch label="Search by name" hint="Type a name" width={190} highlight /></Pic>,
      tip: "A brother whose renewal has lapsed cannot be seated.",
    },
    {
      id: "all-records",
      title: "From all records",
      body: "For someone from another area, use the second tab. Type his name or gift name and the mobile number he registered with. Both must match, so you cannot browse strangers.",
      illustration: <Pic gap={6}><FieldSketch label="Name or gift name" hint="TANGLAW" width={110} /><FieldSketch label="Mobile number" hint="0917 123 4567" width={110} /></Pic>,
    },
    {
      id: "reason",
      title: "Seating from outside needs a reason",
      body: "Seating someone from outside the jurisdiction is allowed. You write why, and it is recorded permanently, with your name, where everyone can read it. It is never removed.",
      illustration: <Pic><FieldSketch label="Reason" kind="textarea" hint="Why he is seated here" width={190} highlight /></Pic>,
    },
    {
      id: "confirm",
      title: "Seated from, then Confirm",
      body: "The Seated from date starts today. Change it if the term began earlier. Then Confirm seat finishes the job.",
      illustration: <Pic><FieldSketch label="Seated from" kind="date" value="Today" width={130} /><SketchButton>CONFIRM SEAT</SketchButton></Pic>,
    },
    {
      id: "link",
      title: "Send him his link, once",
      body: "If he has no account yet, a one-time enrolment link appears. Copy it now and send it to him yourself. It is shown only once. He sets his own password. Nobody is ever sent one.",
      illustration: <Pic><IconBadge kind="lock" /><ArrowRight /><BadgeSketch tone="brass">Copy link</BadgeSketch></Pic>,
      tip: "Closed it by mistake? It cannot be shown again, so keep it until you have sent it.",
    },
    {
      id: "unseat", route: pick("seated"), target: "roster-unseat-first", waitMs: wait,
      title: "Unseat, with a reason",
      body: "When an officer's term ends, Unseat asks for a reason, which is recorded. His name moves to Past officers. Nothing is deleted.",
    },
    {
      id: "last-officer",
      title: "When the last officer leaves",
      body: "The council is then called Dormant, and a warning shows on its roster. Registrations waiting at that council are not stuck. They move up to the nearest council above that still has officers.",
      illustration: <Pic><BadgeSketch tone="danger">Dormant</BadgeSketch><ArrowRight /><BadgeSketch tone="ok">Council above approves</BadgeSketch></Pic>,
    },
    {
      id: "done",
      title: "That's seating",
      body: "You can run this guide again anytime from Help & guides.",
      illustration: <Pic><StepStrip steps={["Pick council", "Seat", "Send link"]} active={3} /></Pic>,
    },
  ];
}

export const seatingGuide: GuideDefinition = {
  key: "guide-portal-seating",
  title: "Seat or unseat a council officer",
  summary: "Choose a brother for an office, send him his one-time link, and know what happens if a council has no officers left.",
  group: "Councils",
  version: 1,
  audience: ctx => canSeatCouncilOfficers(ctx.roles),
  buildSteps: buildSeatingGuideSteps,
};
