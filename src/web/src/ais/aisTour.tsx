import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/shared/auth";
import { useMemberAccess } from "@/shared/memberAccess";
import { canApproveApplications, canFileOfficerRoster } from "@/shared/roles";
import { useTour } from "@/shared/tour/TourProvider";
import { useTourAutoStart } from "@/shared/tour/useTourAutoStart";
import { AIS_TOUR_KEY, AIS_TOUR_VERSION, type TourStep } from "@/shared/tour/types";
import { BadgeSketch, IconBadge, Pic, PhoneFrame, SketchLine, SketchRow, StepStrip } from "@/shared/tour/illustrations";

interface AisTourInput {
  giftName: string | undefined;
  isFeatureOpen: (featureKey: string) => boolean;
  canApprove: boolean;
  canFileRoster: boolean;
}

/**
 * The member's welcome tour (tourKey "ais-welcome"). Short, friendly, in the order a new
 * brother would naturally explore. Steps for features the free trial has closed are left out
 * (the tour must never point at a locked door), and so are officer-only steps for plain members.
 * Contributions are described as voluntary — nothing here implies anyone owes anything.
 */
export function buildAisTourSteps({ giftName, isFeatureOpen, canApprove, canFileRoster }: AisTourInput): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome", route: "/",
      title: giftName ? `Welcome, ${giftName}!` : "Welcome!",
      body: "This app is your chapter's shared books: meetings, funds, notices and your digital ID. Let's take a quick look around. It only takes a minute.",
      illustration: <Pic><IconBadge kind="book" /><StepStrip steps={["Look around", "Learn", "Use it"]} active={0} /></Pic>,
    },
    {
      id: "home", route: "/", target: "home-greeting",
      title: "Your Home",
      body: "This is where you land each time you open the app. What needs your attention is right here.",
    },
    {
      id: "notices", target: "tab-notices",
      title: "Notices",
      body: "Announcements and memos from your chapter and from the National Council show up here.",
      illustration: <Pic><IconBadge kind="bell" tone="ink" /></Pic>,
    },
  ];

  if (isFeatureOpen("Members")) {
    steps.push({
      id: "members", target: "tab-members",
      title: "Members",
      body: "Your chapter's directory. Look up any brother in your chapter.",
    });
  }
  if (isFeatureOpen("Meetings")) {
    steps.push({
      id: "meetings", target: "tab-meetings",
      title: "Meetings",
      body: "Meetings and who attended. Contributions are always voluntary. Give what you can, when you can.",
      illustration: (
        <Pic>
          <PhoneFrame>
            <SketchRow pill={<BadgeSketch tone="neutral">Draft</BadgeSketch>} /><SketchRow pill={<BadgeSketch tone="brass">Finalized</BadgeSketch>} /><SketchLine w="40%" />
          </PhoneFrame>
        </Pic>
      ),
    });
  }
  if (isFeatureOpen("Funds")) {
    steps.push({
      id: "funds", target: "tab-funds",
      title: "Funds",
      body: "The chapter's running balance. Every member sees the same books, so everyone can see where the money goes.",
    });
  }
  if (isFeatureOpen("DigitalId")) {
    steps.push({
      id: "digital-id", route: "/", target: "home-digital-id",
      title: "Your Digital ID",
      body: "Your ID with a QR code, always in your pocket. It also shows the year you are renewed through.",
    });
  }

  steps.push({
    id: "profile", target: "profile-link",
    title: "Your profile",
    body: "Tap your gift name up here to change your photo, password and notifications. You will also find Help & guides there.",
  });

  if (canApprove && isFeatureOpen("ChapterAdmin")) {
    steps.push({
      id: "applications", target: "tab-applications",
      title: "Applications",
      body: "As an officer, this is where you approve new sign-ups to your chapter.",
    });
  }
  if (canFileRoster && isFeatureOpen("ChapterAdmin")) {
    steps.push({
      id: "officers", target: "tab-officers",
      title: "Officers",
      body: "Seat or unseat your chapter's officers here, so the right brothers have the right access.",
    });
  }

  steps.push(
    {
      id: "help", route: "/profile", target: "help-link", waitMs: 6000,
      title: "Help & guides",
      body: "Want to learn how to do things? Tap Help & guides here for step-by-step walk-throughs on the real screens.",
      illustration: <Pic><BadgeSketch tone="ok">{"\u2713"} Done</BadgeSketch><StepStrip steps={["Pick a guide", "Follow along"]} active={0} /></Pic>,
    },
    {
      id: "install", when: env => !env.standalone,
      title: "Keep it on your phone",
      body: (
        <>
          <p style={{ margin: "0 0 8px" }}>Add this app to your home screen so it opens like any other app.</p>
          <p style={{ margin: "0 0 8px" }}><strong>Android (Chrome):</strong> tap the menu (three dots), then &ldquo;Add to Home screen&rdquo;.</p>
          <p style={{ margin: 0 }}><strong>iPhone (Safari):</strong> tap Share, then &ldquo;Add to Home Screen&rdquo;.</p>
        </>
      ),
    },
    {
      id: "done",
      title: "You're all set!",
      body: "You can take this tour again anytime from your Profile, and Help & guides is always there when you want to learn how to do something.",
      illustration: <Pic><IconBadge kind="check" /></Pic>,
    },
  );
  return steps;
}

function useAisTourSteps(): () => TourStep[] {
  const { claims } = useAuth();
  const { isFeatureOpen } = useMemberAccess();
  const roles = claims?.roles ?? [];
  const giftName = claims?.giftName;
  const canApprove = canApproveApplications(roles);
  const canFileRoster = canFileOfficerRoster(roles);
  return useCallback(
    () => buildAisTourSteps({ giftName, isFeatureOpen, canApprove, canFileRoster }),
    [giftName, canApprove, canFileRoster, isFeatureOpen],
  );
}

/** Mount once inside the member shell: starts the tour on Home the first time. */
export function useAisTourAutoStart(): void {
  const { pathname } = useLocation();
  const buildSteps = useAisTourSteps();
  useTourAutoStart({
    tourKey: AIS_TOUR_KEY, tourVersion: AIS_TOUR_VERSION, enabled: pathname === "/", buildSteps,
  });
}

/** For the Profile screen's "Take the tour again" button. Does nothing outside the shell. */
export function useReplayAisTour(): () => void {
  const tour = useTour();
  const buildSteps = useAisTourSteps();
  return useCallback(() => {
    tour.start({ tourKey: AIS_TOUR_KEY, tourVersion: AIS_TOUR_VERSION, steps: buildSteps() });
  }, [tour, buildSteps]);
}
