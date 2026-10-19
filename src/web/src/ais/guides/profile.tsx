import type { GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, IconBadge, Pic, StepStrip,
} from "@/shared/tour/illustrations";
import type { TourStep } from "@/shared/tour/types";

/**
 * guide-profile — "Your profile and settings". Profile link -> your record (read-only) ->
 * what you can edit -> photo -> password -> phone alerts -> the tour and Help buttons ->
 * putting the app on the home screen.
 *
 * Nothing is saved while the guide runs (the engine blocks every tap and submit).
 * The install step is left out when the app is already installed (env.standalone).
 *
 * Targets (data-tour) live on: AppShell (profile-link), Profile (profile-record,
 * profile-details, profile-photo, profile-password, profile-tour-button, help-link),
 * NotificationSettings (profile-notifications).
 */
export function buildProfileGuideSteps(): TourStep[] {
  const wait = 5000;
  return [
    {
      id: "intro",
      title: "Your profile",
      body: "Your profile holds your details, your photo, your password and your phone alerts. Let us take a quick look.",
      illustration: <Pic><IconBadge kind="people" /></Pic>,
    },
    {
      id: "link", route: "/", target: "profile-link",
      title: "Tap your name",
      body: "Your gift name at the top right of every screen opens your profile.",
    },
    {
      id: "record", route: "/profile", target: "profile-record", waitMs: wait,
      title: "Your record",
      body: "Your member number, name, chapter, status and renewal date are shown here. You cannot change these yourself. If something is wrong, ask your chapter Secretary.",
    },
    {
      id: "details", route: "/profile", target: "profile-details", waitMs: wait,
      title: "Details you can change",
      body: "Below this heading are your gift name, birthdate, email, address, work, skills, mobile number and blood type. Change what you need, then tap Save at the bottom.",
      tip: "Changing your mobile number asks for your current password first.",
    },
    {
      id: "photo", route: "/profile", target: "profile-photo", waitMs: wait,
      title: "Your photo",
      body: "Tap Change photo to pick a picture from your phone. The same photo appears on your digital ID.",
    },
    {
      id: "password", route: "/profile", target: "profile-password", waitMs: wait,
      title: "Change your password",
      body: "Type your current password, then the new one twice. The new one needs at least 10 characters. Nobody else ever sees it, not even your officers.",
      illustration: <Pic><BadgeSketch tone="neutral">10 characters or more</BadgeSketch></Pic>,
    },
    {
      id: "alerts", route: "/profile", target: "profile-notifications", waitMs: wait,
      title: "Phone alerts",
      body: "Turn alerts on to hear about private messages and mentions even when the app is closed. The switches below choose which kinds you want.",
      tip: "You can turn any of these off whenever you like.",
    },
    {
      id: "tour", route: "/profile", target: "profile-tour-button", waitMs: wait,
      title: "Take the tour again",
      body: "This button replays the short welcome tour of the app, any time you want a reminder.",
    },
    {
      id: "help", route: "/profile", target: "help-link", waitMs: wait,
      title: "Help & guides",
      body: "This opens the list of step-by-step guides, like this one. A tick shows the ones you have finished.",
    },
    {
      id: "install",
      title: "Put the app on your home screen",
      body: "On Android in Chrome, tap the menu (three dots), then Add to Home screen. On iPhone in Safari, tap Share, then Add to Home Screen. It opens faster and can send you alerts.",
      illustration: <Pic><StepStrip steps={["Menu or Share", "Add to Home", "Open it"]} active={1} /></Pic>,
      when: env => !env.standalone,
    },
    {
      id: "done",
      title: "That's your profile",
      body: "Keep your photo and details up to date so your brothers can recognise you. You can run this guide again from Help & guides.",
      illustration: <Pic><IconBadge kind="check" /></Pic>,
    },
  ];
}

export const profileGuide: GuideDefinition = {
  key: "guide-profile",
  title: "Your profile and settings",
  summary: "Update your details and photo, change your password, and set up phone alerts.",
  group: "For every member",
  version: 1,
  audience: () => true,
  buildSteps: buildProfileGuideSteps,
};
