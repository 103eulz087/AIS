import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { EmptyState, ScreenSkeleton } from "@/shared/states";
import { groupGuides, guideStepCount, guidesFor, isGuideDone, type GuideDefinition } from "./guides";
import { useTour } from "./TourProvider";
import { TUTORIALS_QUERY_KEY } from "./types";
import { useGuideContext } from "./useGuideContext";

/**
 * The body of the "Help & guides" page, for both apps.
 * GET /api/members/me/tutorials -> which guides he has finished (the ticks).
 *
 * Shows only the guides whose audience() is true for him, grouped by their `group`.
 * Empty: no guides for this person yet. Loading: skeleton until the first answer.
 * Error: the list still shows (the guides work without the ticks) with a quiet note.
 */
export function GuidesPage({ guides, intro, onReplayWelcome, welcomeLabel = "Replay the welcome tour" }: {
  guides: readonly GuideDefinition[];
  intro: string;
  onReplayWelcome?: () => void;
  welcomeLabel?: string;
}) {
  const { claims } = useAuth();
  const ctx = useGuideContext();
  const tour = useTour();
  const q = useQuery({
    queryKey: TUTORIALS_QUERY_KEY,
    queryFn: () => api.get<unknown>("/api/members/me/tutorials"),
    enabled: !!claims,
    staleTime: 30_000,
    retry: false,
  });

  const mine = guidesFor(guides, ctx);
  const groups = groupGuides(mine);
  const rows = q.data;

  function start(g: GuideDefinition) {
    tour.start({
      tourKey: g.key, tourVersion: g.version, steps: g.buildSteps(ctx), ctx, returnToStart: true,
    });
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Help &amp; guides</h1>
      <p style={{ fontSize: 14, color: "var(--slate)", marginTop: 6, lineHeight: 1.55 }}>{intro}</p>

      {q.isLoading && claims ? (
        <ScreenSkeleton rows={4} />
      ) : (
        <>
          {q.isError && (
            <p role="status" style={{ fontSize: 13, color: "var(--mute)", marginTop: 14, lineHeight: 1.5 }}>
              We could not check which guides you have finished, so no ticks are shown right now.{" "}
              <button type="button" onClick={() => { void q.refetch(); }} style={linkBtn}>Try again</button>
            </p>
          )}

          {groups.length === 0 ? (
            <EmptyState
              title="No guides for you yet"
              body="Guides appear here for the things you can do. When your role changes, check back."
            />
          ) : groups.map(grp => (
            <section key={grp.heading} aria-label={grp.heading} style={{ marginTop: 22 }}>
              <h2 style={groupHeadStyle}>{grp.heading}</h2>
              {grp.guides.map(g => {
                const done = isGuideDone(g, rows);
                const n = guideStepCount(g, ctx);
                return (
                  <div key={g.key} data-testid={`guide-${g.key}`} style={cardStyle}>
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{g.title}</span>
                        {done && <span data-testid={`done-${g.key}`} style={doneStyle}>{"✓"} Done</span>}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--slate)", marginTop: 3, lineHeight: 1.5 }}>{g.summary}</div>
                      {n > 0 && (
                        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 4 }}>
                          About <span className="num">{n}</span> {n === 1 ? "step" : "steps"}
                        </div>
                      )}
                    </div>
                    <button
                      type="button" onClick={() => start(g)} aria-label={`${done ? "Do again" : "Start"}: ${g.title}`}
                      style={startBtn}
                    >
                      {done ? "Do again" : "Start"}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}

          {onReplayWelcome && (
            <div style={{ marginTop: 26 }}>
              <button type="button" onClick={onReplayWelcome} style={welcomeBtn}>
                <span aria-hidden="true" style={{ color: "var(--brass)" }}>?</span>
                <span>{welcomeLabel}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const groupHeadStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", fontWeight: 500, marginBottom: 8,
};

const cardStyle: CSSProperties = {
  display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, marginBottom: 10,
  background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r)",
};

const doneStyle: CSSProperties = {
  fontSize: 11.5, padding: "2px 8px", borderRadius: 10, color: "var(--in)", background: "var(--bond)",
  border: "1px solid var(--line)", whiteSpace: "nowrap",
};

const startBtn: CSSProperties = {
  flex: "none", minHeight: "var(--tap)", minWidth: 96, padding: "0 18px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".06em", textTransform: "uppercase",
};

const welcomeBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, minHeight: "var(--tap)", padding: "0 14px",
  background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r)",
  fontSize: 14, fontWeight: 600, color: "var(--ink)",
};

const linkBtn: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 6px", color: "var(--info)", textDecoration: "underline", fontSize: 13,
};
