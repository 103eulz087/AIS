import { api, type Paged } from "@/shared/api";
import { canReviewChapterRegistrations } from "@/shared/roles";
import type { ChapterRegistrationDetail, ChapterRegistrationQueueItem } from "@/shared/types";
import { lazyOnce, type GuideDefinition } from "@/shared/tour/guides";
import {
  ArrowRight, BadgeSketch, FieldSketch, PhoneFrame, Pic, SketchButton, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-portal-registrations — "Review a chapter registration". The Portal reference guide.
 *
 * Shape to copy: ONE lookup (lazyOnce) that fetches data the first time a step needs it and
 * hands every later step its page; each step's `route` is a tiny function over that answer.
 * A step whose page is unavailable returns null and is dropped quietly, so an empty queue or a
 * registration someone else already decided just shortens the guide. Steps that explain
 * (no target) carry the same message either way.
 *
 * Nothing is ever pressed: the tour overlay swallows every tap and form submit.
 *
 * Targets (data-tour): ChapterRegistrationQueue (reg-search, reg-status-filter, reg-first-link);
 * ChapterRegistrationDetail (reg-header, reg-officers, reg-verified-count, reg-officer-first,
 * reg-verify-first, reg-approve, reg-return).
 */
interface Found {
  /** Any registration, to look at. */
  view: string | null;
  /** Only when the caller may verify / approve / return THIS one right now (the detail endpoint says so). */
  verify: string | null;
  approve: string | null;
  returnIt: string | null;
}

const NONE: Found = { view: null, verify: null, approve: null, returnIt: null };
const SUBMITTED = 1;

async function lookUp(): Promise<Found> {
  // The oldest waiting one if there is one; otherwise any, so the screen can at least be looked at.
  let q = await api.get<Paged<ChapterRegistrationQueueItem>>(`/api/chapter-registrations?statusId=${SUBMITTED}&skip=0&take=1`);
  if (!q.items || q.items.length === 0) {
    q = await api.get<Paged<ChapterRegistrationQueueItem>>("/api/chapter-registrations?skip=0&take=1");
  }
  const item = q.items?.[0];
  if (!item) return NONE;
  const path = `/portal/chapter-registrations/${item.registrationId}`;
  if (item.statusName !== "Submitted") return { ...NONE, view: path };
  const d = await api.get<ChapterRegistrationDetail>(`/api/chapter-registrations/${item.registrationId}`);
  return {
    view: path,
    verify: d.canVerify ? path : null,
    approve: d.canApprove ? path : null,
    returnIt: d.canReturn ? path : null,
  };
}

export function buildRegistrationsGuideSteps(_ctx: GuideContext): TourStep[] {
  const found = lazyOnce(lookUp);
  const pick = (k: keyof Found) => async () => (await found())?.[k] ?? null;
  const view = pick("view");
  const detailWait = 6000;
  const QUEUE = "/portal/chapter-registrations";

  return [
    {
      id: "intro",
      title: "Reviewing a chapter registration",
      body: "A chapter files its registration, your council checks the officers, then approves it or sends it back. We will walk through it. Nothing is changed while the guide runs.",
      illustration: <Pic><StepStrip steps={["Open", "Verify", "Decide"]} active={0} /></Pic>,
    },
    {
      id: "search", route: QUEUE, target: "reg-search", waitMs: 5000,
      title: "Find a registration",
      body: "Type a chapter name, a reference number, or the name of an officer on the filing. It only searches the registrations your council is allowed to see.",
      illustration: <Pic><FieldSketch label="Search" hint="Chapter, member or reference no." highlight width={210} /></Pic>,
    },
    {
      id: "filter", route: QUEUE, target: "reg-status-filter",
      title: "Show only what you need",
      body: "Filter by status: Submitted is waiting for you, Returned for correction is back with the chapter, Approved is done.",
      illustration: <Pic gap={6}><BadgeSketch tone="warn">Submitted</BadgeSketch><BadgeSketch tone="danger">Returned</BadgeSketch><BadgeSketch tone="ok">Approved</BadgeSketch></Pic>,
    },
    {
      id: "open-one", route: QUEUE, target: "reg-first-link", waitMs: detailWait,
      title: "Open one",
      body: "Tap a reference number to open that registration. We will open the first one in your list for the next steps.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 6, top: 38, width: 56, height: 22 }}>
            <SketchRow pill={<BadgeSketch tone="warn">Submitted</BadgeSketch>} /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "about-detail",
      title: "Inside a registration",
      body: "Here you see who is asking, and the officers they named. If your list is empty right now, there is nothing to open yet. A registration appears as soon as a chapter files one.",
      illustration: <Pic><StepStrip steps={["Chapter", "Officers", "Decision"]} active={0} /></Pic>,
    },
    {
      id: "header", route: view, target: "reg-header", waitMs: detailWait,
      title: "Which chapter, and where it stands",
      body: "The chapter's name, the reference number, who filed it and its status are at the top.",
    },
    {
      id: "officers", route: view, target: "reg-officers", waitMs: detailWait,
      title: "The officers named",
      body: "The filing names the chapter's eight offices. Next to the heading you can see how many have been checked by your council so far.",
      illustration: <Pic><BadgeSketch tone="warn">Not yet verified</BadgeSketch><ArrowRight /><BadgeSketch tone="ok">Verified</BadgeSketch></Pic>,
    },
    {
      id: "officer-card", route: view, target: "reg-officer-first", waitMs: detailWait,
      title: "One officer",
      body: "Each card shows the office, his gift name and name, and his mobile number. Some offices are recorded only, with no login.",
    },
    {
      id: "verify", route: pick("verify"), target: "reg-verify-first", waitMs: detailWait,
      title: "Verify each officer",
      body: "Once you have checked that the person is who the filing says, for example by calling him or asking the chapter, tap Verify. You can add a short note first. We will not press it for you.",
      tip: "Made a mistake? A verified officer can be un-verified with “Undo verification”.",
      illustration: <Pic><FieldSketch label="Note (optional)" width={150} /><SketchButton>VERIFY</SketchButton></Pic>,
    },
    {
      id: "count", route: view, target: "reg-verified-count", waitMs: detailWait,
      title: "Every officer, then approve",
      body: "Approve stays switched off until every officer shows as verified. This count tells you how far along you are.",
    },
    {
      id: "approve", route: pick("approve"), target: "reg-approve", waitMs: detailWait,
      title: "Approve",
      body: "When all officers are verified, Approve asks you to confirm first. Approving gives the new president a one-time enrolment link. It is shown only once, so have a way to copy and send it ready.",
      illustration: <Pic><SketchButton>APPROVE</SketchButton><ArrowRight /><BadgeSketch tone="ok">Approved</BadgeSketch></Pic>,
    },
    {
      id: "return", route: pick("returnIt"), target: "reg-return", waitMs: detailWait,
      title: "Or return it with a remark",
      body: "If something is not right, return it. You write the reason, at least 10 characters, in plain words. The chapter reads it, fixes the filing and sends it again.",
      illustration: <Pic><FieldSketch label="Reason for returning" kind="textarea" hint="Please correct the mobile number" width={190} /></Pic>,
    },
    {
      id: "next",
      title: "What happens next",
      body: "Approved: the chapter is registered (or its new officers take their seats) and each new officer gets his own enrolment link. Returned: the chapter sees your remark and files again, and it comes back to your list. Either way, the history stays on the registration.",
      illustration: <Pic gap={8}><BadgeSketch tone="ok">Approved</BadgeSketch><span style={{ color: "var(--mute)", fontSize: 11 }}>or</span><BadgeSketch tone="danger">Returned</BadgeSketch></Pic>,
    },
    {
      id: "done",
      title: "That's the review",
      body: "You can run this guide again anytime from Help & guides.",
      illustration: <Pic><StepStrip steps={["Open", "Verify", "Decide"]} active={3} /></Pic>,
    },
  ];
}

export const registrationsGuide: GuideDefinition = {
  key: "guide-portal-registrations",
  title: "Review a chapter registration",
  summary: "Find a registration, check its officers, then approve it or send it back with a remark.",
  group: "Chapters",
  version: 1,
  audience: ctx => canReviewChapterRegistrations(ctx.seats),
  buildSteps: buildRegistrationsGuideSteps,
};

