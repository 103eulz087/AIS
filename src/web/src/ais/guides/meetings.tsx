import { api, type Paged } from "@/shared/api";
import { peso } from "@/shared/format";
import { canFinalizeMeetings, canWriteMeetings } from "@/shared/roles";
import type { MeetingListItem } from "@/shared/types";
import { lazyOnce, type GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, FieldSketch, Pic, PhoneFrame, SketchButton, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-meetings — "Set up a meeting". THE REFERENCE GUIDE: copy this file's shape.
 *
 * It walks the real screens in order: Meetings tab -> "+ New meeting" -> each field of the
 * form -> Save (explained, never pressed) -> one of the chapter's existing DRAFT meetings
 * to show attendance, contributions, Save and Finalize.
 *
 * Safety: the tour overlay blocks every tap and form submit while a guide runs, so nothing
 * here can be saved. The last steps look at an existing draft meeting and change nothing.
 *
 * Targets (data-tour attributes) live on: MeetingList (meetings-new-button), MeetingNew
 * (meeting-field-*, meeting-draft-note, meeting-save), MeetingDetail (meeting-header,
 * meeting-status-buttons, meeting-amount-first, meeting-total, meeting-save-draft,
 * meeting-finalize, meeting-voluntary-note).
 */
export function buildMeetingsGuideSteps(ctx: GuideContext): TourStep[] {
  // Several steps sit on the same meeting page: look the draft up once and share it.
  const findDraftPath = lazyOnce(async () => {
    const chapterId = ctx.claims?.chapterId;
    if (!chapterId) return null;
    const res = await api.get<Paged<MeetingListItem>>(`/api/chapters/${chapterId}/meetings?skip=0&take=25`);
    const draft = (res.items ?? []).find(m => !m.isFinalized);
    return draft ? `/meetings/${draft.meetingId}` : null;
  });
  // null = this chapter has no draft meeting to look at: the steps on that page are left out.
  const draftRoute = () => findDraftPath();
  const detailWait = 6000;

  const steps: TourStep[] = [
    {
      id: "intro",
      title: "Setting up a meeting",
      body: "We will go through it together, one box at a time. Nothing is saved while the guide runs, so you can't break anything.",
      illustration: <Pic><StepStrip steps={["Open", "Fill in", "Attendance", "Save"]} active={0} /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-meetings",
      title: "Start at Meetings",
      body: "Tap Meetings at the bottom of the screen. Every meeting your chapter has held is listed there.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 4, top: 74, width: 30, height: 20 }}>
            <SketchLine w="55%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "new-button", route: "/meetings", target: "meetings-new-button", waitMs: 5000,
      title: "Tap “+ New meeting”",
      body: "This button starts a new meeting. Only chapter officers see it.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 52, top: 26, width: 42, height: 22 }}>
            <SketchButton>+ NEW MEETING</SketchButton><SketchRow pill={<BadgeSketch tone="neutral">Draft</BadgeSketch>} /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "field-subject", route: "/meetings/new", target: "meeting-field-subject", waitMs: 4000,
      title: "Give it a title",
      body: "Write what this meeting is, for example “Regular Chapter Meeting — September”. This is the only name people will see in the list.",
      illustration: <Pic><FieldSketch label="Subject / agenda title" value="Regular Chapter Meeting" highlight /></Pic>,
    },
    {
      id: "field-date", route: "/meetings/new", target: "meeting-field-date",
      title: "Pick the date",
      body: "Tap the box and choose the day the meeting was (or will be) held.",
      illustration: <Pic><FieldSketch label="Meeting date" hint="Choose a date" kind="date" highlight /></Pic>,
      tip: "A title and a date are the only two things you must fill in.",
    },
    {
      id: "field-venue", route: "/meetings/new", target: "meeting-field-venue",
      title: "Where is it?",
      body: "The place, such as the Barangay Hall. You can leave this blank.",
      illustration: <Pic><FieldSketch label="Venue" value="Barangay Hall" highlight /></Pic>,
    },
    {
      id: "field-notes", route: "/meetings/new", target: "meeting-field-notes",
      title: "Agenda or notes",
      body: "Type the agenda, one item to a line, or any notes for the brothers. Also optional.",
      illustration: <Pic><FieldSketch label="Agenda / notes" kind="textarea" hint="1. Reading of minutes" highlight /></Pic>,
    },
    {
      id: "draft-note", route: "/meetings/new", target: "meeting-draft-note",
      title: "Saving makes a draft",
      body: "A saved meeting is a draft that your whole chapter can already see. Attendance and what brothers give are recorded after the meeting, on the next screen.",
      illustration: <Pic><BadgeSketch tone="neutral">Draft</BadgeSketch><StepStrip steps={["Save", "Attendance"]} active={0} /></Pic>,
    },
    {
      id: "save", route: "/meetings/new", target: "meeting-save",
      title: "Save meeting",
      body: "When you are ready, tap this to save. We will not press it for you during this guide.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 8, top: 68, width: 84, height: 22 }}>
            <FieldSketch label="Subject" width="100%" value="Regular Meeting" /><SketchButton>SAVE MEETING</SketchButton>
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "after-save",
      title: "Next: attendance and contributions",
      body: "Once saved, you land on the meeting's own page. That is where you mark who came and write down what each brother gave. If your chapter has a draft meeting, we will show it to you now.",
      illustration: <Pic><StepStrip steps={["Save", "Attendance", "Contributions", "Finalize"]} active={1} /></Pic>,
    },
    {
      id: "header", route: draftRoute, target: "meeting-header", waitMs: detailWait,
      title: "The meeting page",
      body: "The title, date and place are at the top, with a tag showing whether it is still a Draft.",
      illustration: <Pic><BadgeSketch tone="neutral">Draft</BadgeSketch><BadgeSketch tone="brass">Finalized</BadgeSketch></Pic>,
    },
    {
      id: "attendance", route: draftRoute, target: "meeting-status-buttons", waitMs: detailWait,
      title: "Mark who came",
      body: "Each brother has four small buttons: P for Present, L for Late, E for Excused, A for Absent. Tap one to record him. You can change it until the meeting is finalized.",
      illustration: (
        <Pic gap={6}>
          <BadgeSketch tone="brass">P</BadgeSketch><BadgeSketch tone="neutral">L</BadgeSketch>
          <BadgeSketch tone="neutral">E</BadgeSketch><BadgeSketch tone="neutral">A</BadgeSketch>
        </Pic>
      ),
    },
    {
      id: "contribution", route: draftRoute, target: "meeting-amount-first", waitMs: detailWait,
      title: "What he gave, if anything",
      body: "Type the amount a brother gave. Giving is always voluntary: leave it blank, or enter zero, and that is a complete record. Nobody owes anything.",
      illustration: <Pic><FieldSketch label="Amount" value={peso(0)} kind="text" highlight width={140} /></Pic>,
      tip: "A brother who gave nothing is recorded exactly like one who did.",
    },
    {
      id: "total", route: draftRoute, target: "meeting-total", waitMs: detailWait,
      title: "The total",
      body: "This adds up what you typed for the brothers you marked. It is what would go into the chapter funds when the meeting is finalized.",
    },
    {
      id: "save-draft", route: draftRoute, target: "meeting-save-draft", waitMs: detailWait,
      title: "Save keeps your work",
      body: "Save stores what you have entered. The meeting stays a draft, so you can come back and change it. Nothing goes into the funds yet.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 8, top: 62, width: 84, height: 24 }}>
            <SketchRow /><SketchRow /><SketchButton tone="light">SAVE</SketchButton>
          </PhoneFrame>
        </Pic>
      ),
    },
  ];

  if (canFinalizeMeetings(ctx.roles)) {
    steps.push({
      id: "finalize", route: draftRoute, target: "meeting-finalize", waitMs: detailWait,
      title: "Finalize, only when it is right",
      body: "Finalizing posts the total to the chapter funds as one entry and locks the meeting. It can only be undone by reopening it, which every member of the chapter can see. We will not press it for you.",
      illustration: <Pic><BadgeSketch tone="neutral">Draft</BadgeSketch><span style={{ color: "var(--brass)" }}>{"→"}</span><BadgeSketch tone="brass">Finalized</BadgeSketch></Pic>,
    });
  } else {
    steps.push({
      id: "finalize-note",
      title: "Finalizing is for your President",
      body: "Locking a meeting and posting it to the funds is done by the chapter's President, once everything is checked. You do not need to do it.",
    });
  }

  steps.push({
    id: "done",
    title: "That's a meeting",
    body: "Open Meetings anytime to add another. You can run this guide again from Help & guides.",
    illustration: <Pic><StepStrip steps={["Open", "Fill in", "Attendance", "Save"]} active={4} /></Pic>,
  });
  return steps;
}

export const meetingsGuide: GuideDefinition = {
  key: "guide-meetings",
  title: "Set up a meeting",
  summary: "Create a meeting, mark who came and record what brothers gave.",
  group: "For chapter officers",
  version: 1,
  audience: ctx => canWriteMeetings(ctx.roles) && ctx.isFeatureOpen("Meetings"),
  buildSteps: buildMeetingsGuideSteps,
};
