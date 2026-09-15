import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { peso, shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteMeetings } from "@/shared/roles";
import type { MeetingListItem } from "@/shared/types";

const TAKE = 25;

/**
 * GET /api/chapters/{chapterId}/meetings — newest first (the backend orders this).
 * Empty state: a brand-new chapter with no meetings recorded yet.
 */
export function MeetingList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canCreate = canWriteMeetings(roles);

  const [skip, setSkip] = useState(0);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["meetings", chapterId, skip],
    queryFn: () => api.get<Paged<MeetingListItem>>(
      `/api/chapters/${chapterId}/meetings?skip=${skip}&take=${TAKE}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        title="No meetings recorded yet"
        body="Once your chapter holds a meeting, it appears here with who attended and what was collected."
        action={canCreate ? <Link to="/meetings/new" style={newButtonStyle}>+ New meeting</Link> : undefined}
      />
    );
  }

  return (
    <div>
      {canCreate && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px 0" }}>
          <Link to="/meetings/new" style={newButtonStyle}>+ New meeting</Link>
        </div>
      )}

      {items.map(m => (
        <Link key={m.meetingId} to={`/meetings/${m.meetingId}`} style={rowStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{m.subject}</div>
            <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
              {shortDate(m.meetingDate)}{m.location ? ` · ${m.location}` : ""}
            </div>
            {/* One meeting's own headcount — never a running total across meetings. */}
            <div className="num" style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
              {m.presentCount} present · {m.lateCount} late
            </div>
          </div>

          <div style={{ textAlign: "right", flex: "none" }}>
            <div className="num in" style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>
              {peso(m.collectionTotal)}
            </div>
            {/* Draft is the normal, everyday state of a meeting — not a warning.
                Finalized carries the brass-adjacent "sealed" treatment; draft does not
                get an alarm colour. */}
            <span style={m.isFinalized ? finalizedPillStyle : draftPillStyle}>
              {m.isFinalized ? "Finalized" : "Draft"}
            </span>
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

const pillBase: CSSProperties = {
  display: "inline-block", marginTop: 4, fontSize: 10, padding: "2px 7px", borderRadius: 10,
};

const draftPillStyle: CSSProperties = {
  ...pillBase, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const finalizedPillStyle: CSSProperties = {
  ...pillBase, background: "var(--deep)", color: "var(--brass-soft)",
};

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
