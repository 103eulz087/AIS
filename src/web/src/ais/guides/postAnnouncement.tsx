import { canWriteComms } from "@/shared/roles";
import type { GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, FieldSketch, IconBadge, Pic, PhoneFrame, SketchButton, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-post-announcement — "Post an announcement". Notices tab -> + New announcement ->
 * title, message, urgent switch, expiry -> Post announcement; then (when Memos is open)
 * the numbered, permanent memo.
 *
 * Nothing is posted: the engine blocks every tap and submit. The guide only shows the form.
 *
 * Targets (data-tour) live on: AppShell (tab-notices), AnnouncementList
 * (announcements-new-button), AnnouncementNew (announcement-field-title,
 * announcement-field-body, announcement-urgent, announcement-field-expiry,
 * announcement-post), MemoList (memos-new-button), MemoNew (memo-field-subject,
 * memo-permanent-note, memo-publish).
 */
export function buildPostAnnouncementGuideSteps(ctx: GuideContext): TourStep[] {
  const wait = 5000;
  const steps: TourStep[] = [
    {
      id: "intro",
      title: "Posting an announcement",
      body: "Announcements reach every brother in your chapter. We will go through the form one box at a time. Nothing is posted while the guide runs.",
      illustration: <Pic><IconBadge kind="bell" /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-notices",
      title: "Start at Notices",
      body: "Tap Notices at the bottom of the screen.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 68, top: 74, width: 30, height: 20 }}>
            <SketchLine w="50%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "new-button", route: "/announcements", target: "announcements-new-button", waitMs: wait,
      title: "Tap “+ New announcement”",
      body: "This button is only shown to chapter officers. It opens a blank form.",
      illustration: <Pic><PhoneFrame highlight={{ left: 40, top: 26, width: 54, height: 22 }}><SketchButton>+ NEW ANNOUNCEMENT</SketchButton><SketchRow /><SketchRow /></PhoneFrame></Pic>,
    },
    {
      id: "title", route: "/announcements/new", target: "announcement-field-title", waitMs: 4000,
      title: "Give it a title",
      body: "A short line that tells brothers what it is about, such as General assembly next Sunday. This is what shows in the list.",
      illustration: <Pic><FieldSketch label="Title" value="General assembly next Sunday" highlight /></Pic>,
    },
    {
      id: "body", route: "/announcements/new", target: "announcement-field-body",
      title: "Write the message",
      body: "Say what, when and where in plain words. Remember that everyone in the chapter will read it.",
      illustration: <Pic><FieldSketch label="Body" kind="textarea" hint="Write the announcement" highlight /></Pic>,
    },
    {
      id: "urgent", route: "/announcements/new", target: "announcement-urgent",
      title: "Is it urgent?",
      body: "Switch this on only for a blood request or a call for urgent help. Urgent notices are shown first, with a warning tag, and you can choose the blood type needed.",
      illustration: <Pic><BadgeSketch tone="warn">Urgent · blood request · O+</BadgeSketch></Pic>,
      tip: "Leave it off for everyday news.",
    },
    {
      id: "expiry", route: "/announcements/new", target: "announcement-field-expiry",
      title: "When does it stop mattering?",
      body: "You can choose an expiry date, for example after the event. You can also leave it blank.",
      illustration: <Pic><FieldSketch label="Expires (optional)" hint="Choose a date" kind="date" highlight /></Pic>,
    },
    {
      id: "post", route: "/announcements/new", target: "announcement-post",
      title: "Post announcement",
      body: "Tap this to publish it to the whole chapter. We will not press it for you. Later you can edit it, or withdraw it with a reason. A withdrawn notice stays on record.",
      illustration: <Pic><StepStrip steps={["Write", "Check", "Post"]} active={2} /></Pic>,
    },
  ];

  if (ctx.isFeatureOpen("Memos")) {
    steps.push(
      {
        id: "memo-button", route: "/memos", target: "memos-new-button", waitMs: wait,
        title: "Memos are official papers",
        body: "For an official instruction, publish a memo instead. Tap + New memo on the Memos list. Each memo gets its own number.",
      },
      {
        id: "memo-subject", route: "/memos/new", target: "memo-field-subject", waitMs: 4000,
        title: "The memo's subject",
        body: "Write what the memo is about, for example Guidelines on chapter fund handling. The message goes in the box below.",
        illustration: <Pic><FieldSketch label="Subject" value="Guidelines on fund handling" highlight /></Pic>,
      },
      {
        id: "memo-permanent", route: "/memos/new", target: "memo-permanent-note",
        title: "A memo cannot be changed",
        body: "Once published, a memo is numbered and permanent. It cannot be edited or removed. To correct it, publish a new memo that replaces it.",
        tip: "Read it through twice before you publish.",
      },
    );
  }

  steps.push({
    id: "done",
    title: "That's posting",
    body: "Brothers will see your notice in the Notices tab straight away. You can run this guide again from Help & guides.",
    illustration: <Pic><IconBadge kind="check" /></Pic>,
  });
  return steps;
}

export const postAnnouncementGuide: GuideDefinition = {
  key: "guide-post-announcement",
  title: "Post an announcement",
  summary: "Write a notice for your chapter, mark it urgent when it must be, and publish a memo.",
  group: "For chapter officers",
  version: 1,
  audience: ctx => canWriteComms(ctx.roles) && ctx.isFeatureOpen("Announcements"),
  buildSteps: buildPostAnnouncementGuideSteps,
};
