import { useContext } from "react";
import { GuidesPage } from "@/shared/tour/GuidesPage";
import { PORTAL_GUIDES } from "@/portal/guides";
import { PortalWelcomeContext } from "@/portal/portalTour";

/**
 * "Help & guides" for the Council Portal, at /portal/help.
 * GET /api/members/me/tutorials (inside GuidesPage) for the Done ticks.
 * Empty state: "No guides for you yet" when no guide fits his office.
 */
export function PortalHelp() {
  const replayWelcome = useContext(PortalWelcomeContext);
  return (
    <GuidesPage
      guides={PORTAL_GUIDES}
      intro="Short, step-by-step walk-throughs on the real screens. Pick one and we will show you where to tap. Nothing is changed while a guide runs."
      onReplayWelcome={replayWelcome ?? undefined}
      welcomeLabel="Replay the welcome tour"
    />
  );
}
