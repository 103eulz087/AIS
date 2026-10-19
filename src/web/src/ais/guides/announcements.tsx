import { api, type Paged } from "@/shared/api";
import type { Announcement } from "@/shared/types";
import { lazyOnce, type GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, IconBadge, Pic, PhoneFrame, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-announcements — "Read notices". Notices tab -> Announcements and Memos -> open one
 * announcement -> National or chapter -> memos.
 *
 * Opening a notice is just reading it. The detail steps use the chapter's own newest
 * announcement (found once, shared between steps); with none posted they are dropped and
 * the list steps still read well.
 *
 * Targets (data-tour) live on: AppShell (tab-notices),
 * AnnouncementList (notices-switcher, announcements-first-row), AnnouncementDetail
 * (announcement-title, announcement-body, announcement-national-pill),
 * MemoList (notices-switcher, memos-first-row).
 */
export function buildAnnouncementsGuideSteps(ctx: GuideContext): TourStep[] {
  const wait = 5000;
  const findAll = lazyOnce(async () => {
    const chapterId = ctx.claims?.chapterId;
    if (!chapterId) return [] as Announcement[];
    const res = await api.get<Paged<Announcement>>(`/api/chapters/${chapterId}/announcements?skip=0&take=25`);
    return res.items ?? [];
  });
  const firstRoute = async () => {
    const all = (await findAll()) ?? [];
    const a = all.find(x => !x.isWithdrawn);
    return a ? `/announcements/${a.announcementId}` : null;
  };
  const nationalRoute = async () => {
    const all = (await findAll()) ?? [];
    const a = all.find(x => x.isNational && !x.isWithdrawn);
    return a ? `/announcements/${a.announcementId}` : null;
  };

  const steps: TourStep[] = [
    {
      id: "intro",
      title: "Reading notices",
      body: "Announcements tell you what is happening in your chapter and from the National Council. This tab always stays open to you.",
      illustration: <Pic><IconBadge kind="bell" /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-notices",
      title: "Open Notices",
      body: "Tap Notices at the bottom of the screen to see everything your chapter has posted.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 68, top: 74, width: 30, height: 20 }}>
            <SketchLine w="50%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
  ];

  if (ctx.isFeatureOpen("Memos")) {
    steps.push({
      id: "switcher", route: "/announcements", target: "notices-switcher", waitMs: wait,
      title: "Announcements and Memos",
      body: "Announcements are news and requests. Memos are official, numbered papers. Tap the other name to switch between them.",
      illustration: <Pic gap={6}><BadgeSketch tone="brass">Announcements</BadgeSketch><BadgeSketch>Memos</BadgeSketch></Pic>,
    });
  }

  steps.push(
    {
      id: "list", route: "/announcements", target: "announcements-first-row", waitMs: wait,
      title: "The newest first",
      body: "Each row shows the title and date. Urgent requests, such as someone needing blood, jump to the top with a warning tag. Tap a row to read it.",
      illustration: <Pic><PhoneFrame highlight={{ left: 4, top: 22, width: 92, height: 22 }}><SketchRow pill={<BadgeSketch tone="warn">Urgent</BadgeSketch>} /><SketchRow /><SketchRow /></PhoneFrame></Pic>,
    },
    {
      id: "title", route: firstRoute, target: "announcement-title", waitMs: wait,
      title: "Open one",
      body: "The title and date are at the top. If the notice was edited later, it says so, so you always know you are reading the latest.",
    },
    {
      id: "body", route: firstRoute, target: "announcement-body", waitMs: wait,
      title: "The full message",
      body: "Read the whole notice here. If it asks for help, such as a blood request, the details are written out in plain words.",
    },
    {
      id: "national", route: nationalRoute, target: "announcement-national-pill", waitMs: wait,
      title: "National or your chapter",
      body: "A notice from the National Council carries a National tag. Notices without it come from your own chapter's officers.",
      illustration: <Pic><BadgeSketch tone="brass">National</BadgeSketch><BadgeSketch>Your chapter</BadgeSketch></Pic>,
    },
  );

  if (ctx.isFeatureOpen("Memos")) {
    steps.push({
      id: "memos", route: "/memos", target: "memos-first-row", waitMs: wait,
      title: "Memos stay on record",
      body: "Each memo has its own number and is kept permanently. If a memo changes, a new one replaces it, and the old one shows Superseded.",
      illustration: <Pic><StepStrip steps={["Memo 1", "Replaced by Memo 2"]} active={1} /></Pic>,
    });
  }

  steps.push({
    id: "done",
    title: "That's the notice board",
    body: "Check Notices now and then so you never miss something for the chapter. You can run this guide again from Help & guides.",
    illustration: <Pic><IconBadge kind="check" /></Pic>,
  });
  return steps;
}

export const announcementsGuide: GuideDefinition = {
  key: "guide-announcements",
  title: "Read notices and memos",
  summary: "Find your chapter's announcements, see which are from National, and read memos.",
  group: "For every member",
  version: 1,
  audience: ctx => ctx.isFeatureOpen("Announcements"),
  buildSteps: buildAnnouncementsGuideSteps,
};
