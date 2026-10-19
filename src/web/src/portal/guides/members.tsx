import { canManageMemberAccounts, canSearchMembersByJurisdiction } from "@/shared/roles";
import type { GuideDefinition } from "@/shared/tour/guides";
import { ArrowRight, BadgeSketch, FieldSketch, IconBadge, Pic, SketchButton, StepStrip } from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-portal-members — "Find a member". Audience is the rule PortalShell uses for the Members
 * link. The row buttons only exist after a search the tour cannot type, so View details, Block
 * and Reset password are described, not pointed at. The account steps appear only for council
 * admins (canManageMemberAccounts); the server still limits them to the National Council.
 *
 * Targets (data-tour) on MemberSearch: members-search, members-tabs.
 */
export function buildMembersGuideSteps(ctx: GuideContext): TourStep[] {
  const manage = canManageMemberAccounts(ctx.roles);
  const PAGE = "/portal/members";
  const wait = 5000;
  const steps: TourStep[] = [
    {
      id: "intro",
      title: "Finding a member",
      body: "Look up any brother in your council's area, see his details, and, for National admins, manage his sign-in. Nothing is changed while this guide runs.",
      illustration: <Pic><StepStrip steps={["Search", "Details", "Account"]} active={0} /></Pic>,
    },
    {
      id: "search", route: PAGE, target: "members-search", waitMs: wait,
      title: "Search the jurisdiction",
      body: "Type at least two characters: a gift name, legal name, member number or mobile number. You only see members inside your own council's area. National sees everyone.",
      illustration: <Pic><FieldSketch label="Search" hint="Name, member number, or mobile…" width={210} highlight /></Pic>,
    },
    {
      id: "results",
      title: "Reading a result",
      body: "Each result shows his gift name and member number, legal name, chapter, area, mobile number, status and renewal date. A Blocked tag shows if his sign-in is blocked. No matches simply says so.",
      illustration: <Pic><BadgeSketch tone="ok">Active</BadgeSketch><BadgeSketch tone="danger">Blocked</BadgeSketch></Pic>,
    },
    {
      id: "details",
      title: "View details",
      body: "View details opens his full record under his row: legal name, area, date survive, master initiator, address, email, blood type and more. Tap Hide to close it.",
      illustration: <Pic><SketchButton tone="light">VIEW DETAILS</SketchButton></Pic>,
      tip: "Keep these details to yourself. They are shown to you for your work as an officer.",
    },
  ];
  if (manage) {
    steps.push(
      {
        id: "block",
        title: "Block or unblock a sign-in",
        body: "Block stops his login and Unblock restores it. You must write a reason, and it is recorded. The server allows this only for the National Council. Blocking is not a discipline record.",
        illustration: <Pic><SketchButton tone="light">BLOCK</SketchButton><ArrowRight /><FieldSketch label="Reason" hint="Why" width={120} /></Pic>,
      },
      {
        id: "reset",
        title: "Reset password",
        body: "If a brother is locked out, Reset password makes a fresh one-time link. You never see or type a password. Copy the link, shown once, and send it to him. He sets his own.",
        illustration: <Pic><IconBadge kind="lock" /><ArrowRight /><BadgeSketch tone="brass">One-time link</BadgeSketch></Pic>,
      },
      {
        id: "blocked-tab", route: PAGE, target: "members-tabs", waitMs: wait,
        title: "Blocked members",
        body: "The Blocked members tab lists everyone currently blocked, with the reason, the date and who blocked him. From there you can Unblock or View details.",
      },
    );
  }
  steps.push({
    id: "done",
    title: "That's the Members screen",
    body: "You can run this guide again anytime from Help & guides.",
    illustration: <Pic><StepStrip steps={["Search", "Details", "Account"]} active={3} /></Pic>,
  });
  return steps;
}

export const membersGuide: GuideDefinition = {
  key: "guide-portal-members",
  title: "Find a member",
  summary: "Search your jurisdiction, see a member's details and, for National admins, block him or send a fresh sign-in link.",
  group: "Members",
  version: 1,
  audience: ctx => canSearchMembersByJurisdiction(ctx.seats) || canManageMemberAccounts(ctx.roles),
  buildSteps: buildMembersGuideSteps,
};
