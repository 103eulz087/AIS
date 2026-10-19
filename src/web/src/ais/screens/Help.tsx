import { GuidesPage } from "@/shared/tour/GuidesPage";
import { useReplayAisTour } from "@/ais/aisTour";
import { AIS_GUIDES } from "@/ais/guides";

/**
 * "Help & guides" for the member app, at /help.
 * GET /api/members/me/tutorials (inside GuidesPage) for the Done ticks.
 * Empty state: "No guides for you yet" when no guide fits his role.
 */
export function Help() {
  const replay = useReplayAisTour();
  return (
    <div style={{ padding: "20px 20px 40px" }}>
      <GuidesPage
        guides={AIS_GUIDES}
        intro="Short, step-by-step walk-throughs on the real screens. Pick one and we will show you where to tap. Nothing is changed while a guide runs."
        onReplayWelcome={replay}
      />
    </div>
  );
}
