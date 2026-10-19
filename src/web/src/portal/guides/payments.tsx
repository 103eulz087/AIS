import { canSetPaymentTags, canViewPaymentReport, canViewPaymentTags } from "@/shared/roles";
import type { GuideDefinition } from "@/shared/tour/guides";
import { ArrowRight, BadgeSketch, FieldSketch, Pic, SketchButton, StepStrip } from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-portal-payments — "Payment tags and the payment report".
 *
 * Tags are labels (Paid / Free / Unpaid) a National officer sets for the membership year. They
 * are never amounts, and nothing here computes or implies money owed (invariant 5).
 *
 * Steps for the tags screen appear only when the caller can view tags; steps for the report only
 * when he can view the report; the Paid/Free/Unpaid buttons step only when he can also set tags.
 * The tag buttons and the member list sit behind a search the tour cannot type, so they are
 * described, not pointed at. On a phone the place, year and sort controls fold behind one
 * "Filters & sort" button, so there is one step for it on phones and separate steps otherwise.
 *
 * Targets (data-tour): MemberPaymentTags (pay-tabs, pay-search, pay-status-filter);
 * MemberPaymentTagStats (pay-report-search, pay-report-filters-toggle, pay-report-place,
 * pay-report-year, pay-report-sort, pay-report-chips, pay-report-tiles, pay-report-table,
 * pay-report-csv).
 */
export function buildPaymentsGuideSteps(ctx: GuideContext): TourStep[] {
  const tags = canViewPaymentTags(ctx.seats);
  const report = canViewPaymentReport(ctx.seats);
  const setting = canSetPaymentTags(ctx.seats);
  const TAGS = "/portal/member-payment-tags";
  const REPORT = "/portal/member-payment-tags/stats";
  const wait = 6000;
  const steps: TourStep[] = [];

  steps.push({
    id: "intro",
    title: "Payment tags and the report",
    body: "A payment tag is a label on a member for this membership year: Paid, Free or Unpaid. It is only a label. No amounts are kept here. Nothing is changed while this guide runs.",
    illustration: <Pic gap={6}><BadgeSketch tone="ok">Paid</BadgeSketch><BadgeSketch tone="info">Free</BadgeSketch><BadgeSketch tone="danger">Unpaid</BadgeSketch></Pic>,
  });

  if (tags) {
    steps.push(
      {
        id: "tags-tabs", route: TAGS, target: "pay-tabs", waitMs: wait,
        title: "Two ways to find members",
        body: "By chapter lists everybody in one chapter. By member finds one brother anywhere, without knowing his chapter.",
      },
      {
        id: "tags-search", route: TAGS, target: "pay-search", waitMs: wait,
        title: "Search",
        body: "Type at least two letters. By chapter, you get a list of chapters to open. By member, you search a name, gift name or member number.",
        illustration: <Pic><FieldSketch label="Chapter name" hint="Chapter name…" width={190} highlight /></Pic>,
      },
      {
        id: "tags-filter", route: TAGS, target: "pay-status-filter", waitMs: wait,
        title: "Show only some",
        body: "The chips narrow the list to All, Paid, Free or Unpaid. Handy for finding who still needs a tag.",
      },
    );
    if (setting) {
      steps.push({
        id: "tags-buttons",
        title: "Tag a member",
        body: "In the list, each member has three buttons: Paid, Free and Unpaid. Tap one and it is saved at once, with your name beside it. Free is for members given free membership this year.",
        illustration: <Pic gap={6}><SketchButton tone="light">PAID</SketchButton><SketchButton tone="light">FREE</SketchButton><SketchButton tone="light">UNPAID</SketchButton></Pic>,
        tip: "Tagged by mistake? Tap the right button. The newest tag is the one that counts.",
      });
    } else {
      steps.push({
        id: "tags-readonly",
        title: "You can look, not change",
        body: "Your office can see the tags but not change them. Changing them needs the Update payment tags permission, which your council's President can give.",
      });
    }
  }

  if (report) {
    steps.push(
      {
        id: "report-search", route: REPORT, target: "pay-report-search", waitMs: wait,
        title: "The Payment report",
        body: "One row per chapter, counting its members by tag. Search by chapter, region, province or city to narrow it as you type.",
        illustration: <Pic><FieldSketch label="Search" hint="Chapter, region, province or city…" width={210} highlight /></Pic>,
      },
      {
        id: "report-filters-phone", route: REPORT, target: "pay-report-filters-toggle", waitMs: wait,
        when: env => env.narrow,
        title: "Filters and sort",
        body: "On a phone, Region, Province, City, the membership year and the sort order are tucked behind this button. Open it to use them.",
      },
      {
        id: "report-place", route: REPORT, target: "pay-report-place", waitMs: wait,
        when: env => !env.narrow,
        title: "Region, then province, then city",
        body: "Pick a region and the province list shortens to that region. Pick a province and the city list shortens too.",
        illustration: <Pic gap={4}><FieldSketch label="Region" kind="select" value="All regions" width={80} /><ArrowRight /><FieldSketch label="Province" kind="select" value="All" width={70} /></Pic>,
      },
      {
        id: "report-year", route: REPORT, target: "pay-report-year", waitMs: wait,
        when: env => !env.narrow,
        title: "Membership year",
        body: "Look at an earlier year if you need to. The membership year runs from 9 August to 8 August.",
      },
      {
        id: "report-sort", route: REPORT, target: "pay-report-sort", waitMs: wait,
        when: env => !env.narrow,
        title: "Sort",
        body: "Order the chapters by name, by most unpaid, by lowest share paid or free, or by most members.",
      },
      {
        id: "report-chips", route: REPORT, target: "pay-report-chips", waitMs: wait,
        title: "Quick filters",
        body: "These chips show every chapter, only those with unpaid members, those where everyone is paid or free, or those where nobody is tagged yet.",
      },
      {
        id: "report-tiles", route: REPORT, target: "pay-report-tiles", waitMs: wait,
        title: "Tap a box to see the members",
        body: "The boxes add up what is on screen. Tap Paid, Free, Unpaid or Total members to see who is behind the number, with the date each was tagged. Tap a chapter row to see just its members.",
        tip: "A figure you can open is a figure you can check.",
      },
      {
        id: "report-csv", route: REPORT, target: "pay-report-csv", waitMs: wait,
        title: "Download CSV",
        body: "Save exactly what is shown as a spreadsheet file, to keep or share. It follows your current search and filters.",
      },
    );
  }

  steps.push({
    id: "done",
    title: "That's payment tags",
    body: "You can run this guide again anytime from Help & guides.",
    illustration: <Pic><StepStrip steps={["Find", "Tag", "Report"]} active={3} /></Pic>,
  });
  return steps;
}

export const paymentsGuide: GuideDefinition = {
  key: "guide-portal-payments",
  title: "Payment tags and the payment report",
  summary: "Tag members Paid, Free or Unpaid, and read the report of how every chapter stands.",
  group: "Members",
  version: 1,
  audience: ctx => canViewPaymentTags(ctx.seats) || canViewPaymentReport(ctx.seats),
  buildSteps: buildPaymentsGuideSteps,
};
