import type { GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, IconBadge, Pic, PhoneFrame, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-members — "Find a brother". Walks the Members tab: the blood-type buttons, one
 * brother's row, the Message button, and the Corrective actions link.
 *
 * The directory has no search box today (only blood-type buttons), so the guide says so
 * honestly instead of describing a box that is not there.
 *
 * Targets (data-tour) live on: AppShell (tab-members), MemberDirectory (members-blood-filter,
 * members-first-row, members-message, members-corrective-link).
 */
export function buildMembersGuideSteps(ctx: GuideContext): TourStep[] {
  const wait = 5000;
  const steps: TourStep[] = [
    {
      id: "intro",
      title: "Finding a brother",
      body: "The Members tab is your chapter's directory. We will look at how to find a brother and what you can see about him.",
      illustration: <Pic><IconBadge kind="people" /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-members",
      title: "Open Members",
      body: "Tap Members at the bottom of the screen. Every brother in your chapter is listed there.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 20, top: 74, width: 30, height: 20 }}>
            <SketchLine w="50%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "blood-filter", route: "/members", target: "members-blood-filter", waitMs: wait,
      title: "Narrow the list by blood type",
      body: "These buttons show only brothers of one blood type. Useful when someone needs blood in a hurry. Tap All to see everyone again.",
      illustration: <Pic gap={6}><BadgeSketch tone="brass">All</BadgeSketch><BadgeSketch>O+</BadgeSketch><BadgeSketch>A+</BadgeSketch><BadgeSketch>B+</BadgeSketch></Pic>,
      tip: "Scroll the row sideways to see more blood types.",
    },
    {
      id: "row", route: "/members", target: "members-first-row", waitMs: wait,
      title: "One brother, one row",
      body: "His gift name comes first, then his name and work. An office badge shows if he is an officer, and his blood type sits on the right.",
      illustration: <Pic><PhoneFrame highlight={{ left: 4, top: 22, width: 92, height: 22 }}><SketchRow pill={<BadgeSketch tone="brass">O+</BadgeSketch>} /><SketchRow /><SketchRow /></PhoneFrame></Pic>,
    },
  ];

  if (ctx.isFeatureOpen("PrivateMessages")) {
    steps.push({
      id: "message", route: "/members", target: "members-message", waitMs: wait,
      title: "Send him a private message",
      body: "Tap Message to start a private conversation with that brother. Only the two of you can read it. We will not press it for you.",
    });
  }

  steps.push({
    id: "privacy",
    title: "What you can and cannot see",
    body: "In your own chapter you see names, work and blood type. For a brother in another chapter you only see his name, his chapter and his status. No phone number, no blood type.",
    illustration: <Pic><StepStrip steps={["Your chapter", "Other chapters"]} active={0} /></Pic>,
  });

  if (ctx.isFeatureOpen("CorrectiveActions")) {
    steps.push({
      id: "corrective", route: "/members", target: "members-corrective-link", waitMs: wait,
      title: "Corrective actions",
      body: "This opens the chapter's record of corrective actions. Everyone sees the name, kind, status and date. The written details are only for officers and the brother concerned.",
      tip: "This is a record kept openly by the chapter, so nobody is left guessing.",
    });
  }

  steps.push({
    id: "done",
    title: "That's the directory",
    body: "Come back to Members whenever you need to reach a brother. You can run this guide again from Help & guides.",
    illustration: <Pic><IconBadge kind="check" /></Pic>,
  });
  return steps;
}

export const membersGuide: GuideDefinition = {
  key: "guide-members",
  title: "Find a brother",
  summary: "Look through your chapter's directory and see what each row tells you.",
  group: "For every member",
  version: 1,
  audience: ctx => ctx.isFeatureOpen("Members"),
  buildSteps: buildMembersGuideSteps,
};
