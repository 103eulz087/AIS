import { canManageAppSettings } from "@/shared/roles";
import type { GuideDefinition } from "@/shared/tour/guides";
import { ArrowRight, BadgeSketch, FieldSketch, Pic, SketchButton, StepStrip } from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-portal-settings — "Set the free trial". National only (AppSettings.Manage). The warning
 * box only shows after a change is made on the page, which the tour never does, so it is
 * described rather than pointed at. Wording keeps to "limited", never "owing" (invariant 5).
 *
 * Targets (data-tour) on AppSettings: settings-trial-toggle, settings-days, settings-open-features,
 * settings-preview, settings-save.
 */
export function buildSettingsGuideSteps(_ctx: GuideContext): TourStep[] {
  const PAGE = "/portal/settings";
  const wait = 6000;
  return [
    {
      id: "intro",
      title: "The free trial",
      body: "A member who is not yet tagged Paid or Free can use the whole app for a number of days. This guide shows how to set that for every member. Nothing is changed while it runs.",
      illustration: <Pic><StepStrip steps={["Switch", "Days", "Save"]} active={0} /></Pic>,
    },
    {
      id: "toggle", route: PAGE, target: "settings-trial-toggle", waitMs: wait,
      title: "Free trial on or off",
      body: "When it is off, everyone keeps full use of the app. When it is on, members whose free trial is over can use only the features ticked below.",
      illustration: <Pic><BadgeSketch tone="neutral">Free trial is off</BadgeSketch><ArrowRight /><BadgeSketch tone="ok">Free trial is on</BadgeSketch></Pic>,
    },
    {
      id: "days", route: PAGE, target: "settings-days", waitMs: wait,
      title: "Number of days",
      body: "From 1 to 365 days. They are counted from the day a member is approved, not from today.",
      illustration: <Pic><FieldSketch label="Number of days" value="30" width={110} highlight /></Pic>,
    },
    {
      id: "open", route: PAGE, target: "settings-open-features", waitMs: wait,
      title: "Still open after the trial",
      body: "Tick the features that stay open to everyone. Announcements are always open and cannot be unticked. Signing in and each member's own profile always work too.",
      tip: "The Council Portal is never affected by these settings.",
    },
    {
      id: "preview", route: PAGE, target: "settings-preview", waitMs: wait,
      title: "Who this touches",
      body: "Before you save, this counts members who are paid or free, still in their trial, or whose trial is over. Being limited is not a penalty. It ends once they are tagged Paid or Free.",
    },
    {
      id: "warning",
      title: "The warning when switching on",
      body: "If you switch the trial on while members' trials are already over, a warning says how many will be limited as soon as you save. Read it first. They can still read announcements.",
      illustration: <Pic><BadgeSketch tone="warn">Will limit 12 members</BadgeSketch></Pic>,
    },
    {
      id: "save", route: PAGE, target: "settings-save", waitMs: wait,
      title: "Save settings",
      body: "Save stays dim until you change something. Undo changes puts everything back. We will not press it for you. It takes effect for every member right away.",
      illustration: <Pic><SketchButton>SAVE SETTINGS</SketchButton></Pic>,
    },
    {
      id: "done",
      title: "That's app settings",
      body: "You can run this guide again anytime from Help & guides.",
      illustration: <Pic><StepStrip steps={["Switch", "Days", "Save"]} active={3} /></Pic>,
    },
  ];
}

export const settingsGuide: GuideDefinition = {
  key: "guide-portal-settings",
  title: "Set the free trial",
  summary: "Choose how long new members have full use of the app, and which features stay open afterwards.",
  group: "Settings",
  version: 1,
  audience: ctx => canManageAppSettings(ctx.seats),
  buildSteps: buildSettingsGuideSteps,
};
