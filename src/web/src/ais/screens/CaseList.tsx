import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteDiscipline } from "@/shared/roles";
import type { CorrectiveActionCase } from "@/shared/types";

const TAKE = 25;

function statusLabel(name: string): string {
  return name; // the four status strings are already the words a member should read
}

function statusPillStyle(statusName: string): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block", fontSize: 10.5, padding: "3px 9px", borderRadius: 10, whiteSpace: "nowrap",
  };
  // Deliberately procedural, not alarming — a corrective action is a disciplinary
  // process, not an emergency (CLAUDE.md §4.5's own tone). No red anywhere here.
  switch (statusName) {
    case "Pending":
      return { ...base, background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8" };
    case "Under Review":
      return { ...base, background: "#EFF4F9", color: "var(--info)", border: "1px solid var(--line)" };
    case "Reconciled":
    case "Dismissed":
      return { ...base, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)" };
    default:
      return { ...base, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)" };
  }
}

/**
 * GET /api/chapters/{chapterId}/corrective-actions?skip=&take= — newest-dateFiled-first
 * (the server orders this). Open to every signed-in member of the chapter; each row is
 * EITHER the summary shape or the detail shape depending on who is asking, decided
 * entirely server-side (ScopeGuard.CanSeeCaseNarrative). This screen never checks who
 * can see what — it renders exactly, and only, what arrived on each row, and a row you
 * can see the narrative for looks IDENTICAL here to one you can't; the extra fields
 * only ever surface on the detail screen, one tap in.
 *
 * "File a new case" is gated on canWriteDiscipline (ChapterAdmin only) — reading the
 * list itself is not gated at all, every member of the chapter can open this screen.
 *
 * Empty state: a chapter with no corrective actions filed, which is the normal,
 * everyday state for most chapters most of the time.
 */
export function CaseList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canFile = canWriteDiscipline(roles);

  const [skip, setSkip] = useState(0);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["corrective-actions", chapterId, skip],
    queryFn: () => api.get<Paged<CorrectiveActionCase>>(
      `/api/chapters/${chapterId}/corrective-actions?skip=${skip}&take=${TAKE}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        title="No corrective actions on file"
        body="When a chapter admin files one, it appears here — the whole chapter sees the brother's name, the category, the status and the date."
        action={canFile ? <Link to="/corrective-actions/new" style={newButtonStyle}>+ File a case</Link> : undefined}
      />
    );
  }

  return (
    <div>
      <div style={{ padding: "16px 16px 0" }}>
        <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".03em" }}>
          Corrective actions
        </h1>
        <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 4, lineHeight: 1.6 }}>
          Every brother sees the name, category, status and date. The written account is
          kept between the officers and the brother concerned.
        </p>
      </div>

      {canFile && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px 0" }}>
          <Link to="/corrective-actions/new" style={newButtonStyle}>+ File a case</Link>
        </div>
      )}

      <div>
        {items.map(c => (
          <Link
            key={c.caseId} to={`/corrective-actions/${c.caseId}`} style={rowStyle}
            data-testid={`case-row-${c.caseId}`}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.giftName}</div>
              <div className="num" style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
                {c.memberNumber}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 2 }}>{c.categoryName}</div>
            </div>
            <div style={{ flex: "none", textAlign: "right" }}>
              <span style={statusPillStyle(c.statusName)}>{statusLabel(c.statusName)}</span>
              <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 6 }}>
                Filed {shortDate(c.dateFiled)}
              </div>
              {c.resolutionDate && (
                <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 2 }}>
                  Resolved {shortDate(c.resolutionDate)}
                </div>
              )}
            </div>
          </Link>
        ))}

        {data && data.total > skip + items.length && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <button type="button" onClick={() => setSkip(skip + TAKE)} style={loadMoreStyle}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", padding: 12,
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const newButtonStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0 14px",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em",
  textTransform: "uppercase", textDecoration: "none",
};

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
