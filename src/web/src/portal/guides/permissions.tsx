import type { GuideDefinition } from "@/shared/tour/guides";
import { ArrowRight, BadgeSketch, FieldSketch, Pic, SketchButton, StepStrip } from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-portal-permissions — "See what each office may do". Everyone seated can read the
 * grid; only the council's own President can change it. No lookup is needed: the grid is
 * fetched from the signed-in person's own seat. Steps whose control is not on the page
 * (the picker shows only with two seats, Save only for the President) are dropped by the engine.
 *
 * Targets (data-tour) on CouncilPermissions: perm-council-picker, perm-header, perm-president,
 * perm-office-first, perm-requires-first, perm-national-first, perm-save, perm-history.
 */
export function buildPermissionsGuideSteps(_ctx: GuideContext): TourStep[] {
  const PAGE = "/portal/council-permissions";
  const wait = 6000;
  return [
    {
      id: "intro",
      title: "Office permissions",
      body: "Each office on your council can be allowed to do some things and not others. This guide shows where to read them and how the President changes them. Nothing is changed while it runs.",
      illustration: <Pic><StepStrip steps={["Council", "Offices", "Save"]} active={0} /></Pic>,
    },
    {
      id: "picker", route: PAGE, target: "perm-council-picker", waitMs: wait,
      title: "Pick the council",
      body: "If you hold a seat on more than one council, choose which one to look at here. With one seat, this is skipped.",
      illustration: <Pic><FieldSketch label="Council" kind="select" value="Your council, your office" width={200} highlight /></Pic>,
    },
    {
      id: "header", route: PAGE, target: "perm-header", waitMs: wait,
      title: "Whose permissions these are",
      body: "The council's name is at the top. Anyone seated can read this page. Only that council's own President can change it. For everyone else, the switches stay locked.",
    },
    {
      id: "president", route: PAGE, target: "perm-president", waitMs: wait,
      title: "The President's are fixed",
      body: "The President always has every permission. It cannot be switched off, so no council can be locked out of its own settings.",
      illustration: <Pic><BadgeSketch tone="brass">President: everything</BadgeSketch></Pic>,
    },
    {
      id: "office", route: PAGE, target: "perm-office-first", waitMs: wait,
      title: "One card per office",
      body: "Each other office has a list of switches, with a short line on what each does. A ticked box means that office may do it. The Auditor's card can never hold anything that changes a record.",
    },
    {
      id: "requires", route: PAGE, target: "perm-requires-first", waitMs: wait,
      title: "Some switches need another",
      body: "Look for the line that says Requires. Approve needs Review, and Update payment tags needs View payment tags. Turn one on and its partner turns on too. Turn the partner off and this one goes off with it.",
      illustration: <Pic><BadgeSketch tone="info">Approve</BadgeSketch><ArrowRight /><BadgeSketch tone="ok">needs Review</BadgeSketch></Pic>,
    },
    {
      id: "national", route: PAGE, target: "perm-national-first", waitMs: wait,
      title: "Some are for National only",
      body: "Payment tags, the Payment report and App settings can only be given to offices on the National Council. On any other council they show locked, with the reason written beside them.",
    },
    {
      id: "save", route: PAGE, target: "perm-save", waitMs: wait,
      title: "Save changes",
      body: "As the President you tick what you want, then Save changes lists every change for you to check. You may add a reason, then confirm. We will not press it for you.",
      illustration: <Pic><SketchButton>SAVE CHANGES (2)</SketchButton></Pic>,
      tip: "Offices see their new permissions the next time they open the Portal.",
    },
    {
      id: "history", route: PAGE, target: "perm-history", waitMs: wait,
      title: "Recent changes",
      body: "Every change is written here with who made it, when, and the reason. An empty list just means nothing has been changed yet.",
    },
    {
      id: "done",
      title: "That's office permissions",
      body: "You can run this guide again anytime from Help & guides.",
      illustration: <Pic><StepStrip steps={["Council", "Offices", "Save"]} active={3} /></Pic>,
    },
  ];
}

export const permissionsGuide: GuideDefinition = {
  key: "guide-portal-permissions",
  title: "See what each office may do",
  summary: "Read your council's office permissions, and how the President changes them.",
  group: "Councils",
  version: 1,
  audience: ctx => ctx.seats.length > 0,
  buildSteps: buildPermissionsGuideSteps,
};
