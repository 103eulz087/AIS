import { api, type Paged } from "@/shared/api";
import { canApproveApplications } from "@/shared/roles";
import type { MembershipApplicationQueueItem } from "@/shared/types";
import { lazyOnce, type GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, IconBadge, Pic, PhoneFrame, SketchButton, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { TourStep } from "@/shared/tour/types";

/**
 * guide-approvals — "Approve new members". Applications tab -> the list and its filter ->
 * one application (applicant, seconder) -> Approve / Return for correction / Reject
 * (explained, never pressed) -> the chapter's join link on /invite.
 *
 * Detail steps look at a real application from the chapter: a pending one for the
 * decision buttons, any one for the read-only sections. With none, those steps are
 * dropped and the explaining step in the middle still reads well.
 *
 * Safety: the engine blocks every tap and submit. The guide never generates a join link;
 * it only points at the button (generating a new link would stop the old one working).
 *
 * Targets (data-tour) live on: AppShell (tab-applications), ApplicationQueue
 * (applications-filter, applications-first-row), ApplicationDetail (application-name,
 * application-applicant, application-seconder, application-approve, application-return,
 * application-reject), MemberDirectory (members-invite-link), InviteMembers (invite-generate).
 */
export function buildApprovalsGuideSteps(): TourStep[] {
  const wait = 5000;
  const detailWait = 6000;
  const findPending = lazyOnce(async () => {
    const res = await api.get<Paged<MembershipApplicationQueueItem>>("/api/membership-applications?statusId=1&take=1");
    const a = (res.items ?? [])[0];
    return a ? `/applications/${a.applicationId}` : null;
  });
  const findAny = lazyOnce(async () => {
    const pending = await findPending();
    if (pending) return pending;
    const res = await api.get<Paged<MembershipApplicationQueueItem>>("/api/membership-applications?take=1");
    const a = (res.items ?? [])[0];
    return a ? `/applications/${a.applicationId}` : null;
  });
  const pendingRoute = () => findPending();
  const anyRoute = () => findAny();

  return [
    {
      id: "intro",
      title: "Approving new members",
      body: "When someone asks to join your chapter, the chapter admin decides. We will look at an application and the three choices. Nothing is decided during this guide.",
      illustration: <Pic><IconBadge kind="people" /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-applications",
      title: "Open Applications",
      body: "Tap Applications at the bottom of the screen. Only the chapter admin sees this tab. A number on it means someone is waiting.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 4, top: 74, width: 30, height: 20 }}>
            <SketchLine w="50%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "filter", route: "/applications", target: "applications-filter", waitMs: wait,
      title: "Filter by status",
      body: "Choose All statuses, Pending approval, Returned for correction, Approved or Rejected to narrow the list.",
      illustration: <Pic gap={5}><BadgeSketch tone="warn">Pending</BadgeSketch><BadgeSketch tone="info">Returned</BadgeSketch><BadgeSketch tone="ok">Approved</BadgeSketch></Pic>,
    },
    {
      id: "row", route: "/applications", target: "applications-first-row", waitMs: wait,
      title: "One application",
      body: "Each row shows his gift name, real name, mobile number and status. Tap a row to open the full application.",
    },
    {
      id: "check",
      title: "What to check",
      body: "Does the name match the person? Is the mobile number his own? Was he truly initiated, and does his seconder confirm him? If unsure, ask the seconder before you decide.",
      illustration: <Pic><StepStrip steps={["Open", "Check", "Decide"]} active={1} /></Pic>,
    },
    {
      id: "name", route: anyRoute, target: "application-name", waitMs: detailWait,
      title: "Who is asking",
      body: "His gift name and full name are at the top, with the reference number, the date he applied and the current status.",
    },
    {
      id: "applicant", route: anyRoute, target: "application-applicant", waitMs: detailWait,
      title: "His details",
      body: "Birthdate, mobile number, email, and his date survive with the president and master initiator he named.",
    },
    {
      id: "seconder", route: anyRoute, target: "application-seconder", waitMs: detailWait,
      title: "His seconder",
      body: "This is the brother who vouches for him. Confirmed in green means we found a real member. Not yet confirmed means check with him yourself.",
    },
    {
      id: "approve", route: pendingRoute, target: "application-approve", waitMs: detailWait,
      title: "Approve",
      body: "Approving creates the member record and a member number, and gives you a one-time enrolment link. It is shown only once, so have a way to copy and send it ready. We will not press it.",
      illustration: <Pic><PhoneFrame highlight={{ left: 8, top: 40, width: 84, height: 20 }}><SketchRow /><SketchButton>APPROVE</SketchButton></PhoneFrame></Pic>,
    },
    {
      id: "return", route: pendingRoute, target: "application-return", waitMs: detailWait,
      title: "Return for correction",
      body: "If something is missing or wrong, send it back with a reason of at least 10 characters. The applicant sees your reason and can fix it.",
      tip: "This is the kind choice when it is only a small mistake.",
    },
    {
      id: "reject", route: pendingRoute, target: "application-reject", waitMs: detailWait,
      title: "Reject",
      body: "Reject is final. Give a reason of at least 10 characters, which the applicant will see. When in doubt, use Return for correction instead.",
    },
    {
      id: "invite-link", route: "/members", target: "members-invite-link", waitMs: wait,
      title: "Invite people to apply",
      body: "To bring in new brothers, open Invite members from the Members tab. It gives you your chapter's own sign-up link.",
    },
    {
      id: "invite-generate", route: "/invite", target: "invite-generate", waitMs: wait,
      title: "Your join link and QR code",
      body: "This button makes the link and a QR code to share. The link is shown only once, and a new one stops the old one working. We will not press it.",
      tip: "Share it only with people you want to join.",
    },
    {
      id: "done",
      title: "That's approvals",
      body: "Check Applications every few days so nobody waits long. You can run this guide again from Help & guides.",
      illustration: <Pic><IconBadge kind="check" /></Pic>,
    },
  ];
}

export const approvalsGuide: GuideDefinition = {
  key: "guide-approvals",
  title: "Approve new members",
  summary: "Review a sign-up, approve, return or reject it, and share your chapter's join link.",
  group: "For chapter officers",
  version: 1,
  audience: ctx => canApproveApplications(ctx.roles) && ctx.isFeatureOpen("ChapterAdmin"),
  buildSteps: buildApprovalsGuideSteps,
};
