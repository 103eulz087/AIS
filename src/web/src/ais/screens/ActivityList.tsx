import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { peso, shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteActivities } from "@/shared/roles";
import type { ActivityListItem } from "@/shared/types";
import { FundsTabs } from "./FundsTabs";

const TAKE = 25;

/**
 * GET /api/chapters/{chapterId}/activities — any signed-in member reads this; the
 * backend orders newest first. Empty state: a brand-new chapter with no activity
 * recorded yet.
 *
 * FundedTotal/SpentTotal are the chapter's sanctioned aggregate for an activity (docs
 * §4.6) — unlike a meeting's per-member contribution, these are fine to show plainly.
 * What is NOT shown, here or anywhere in this module: a per-donor total, a donor
 * leaderboard, or any ranking by amount. Each row links into the expense and donation
 * lists filtered to this one activity — that filtered view IS the activity's detail
 * page; there is no separate /activities/:id route.
 */
export function ActivityList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canCreate = canWriteActivities(roles);

  const [skip, setSkip] = useState(0);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["activities", chapterId, skip],
    queryFn: () => api.get<Paged<ActivityListItem>>(
      `/api/chapters/${chapterId}/activities?skip=${skip}&take=${TAKE}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  return (
    <div>
      <FundsTabs active="activities" />

      {items.length === 0 ? (
        <EmptyState
          title="No activities recorded yet"
          body="Once your chapter starts a project — a clean-up drive, a relief effort, a fiesta — it appears here with what came in and what went out."
          action={canCreate ? <Link to="/activities/new" style={newButtonStyle}>+ New activity</Link> : undefined}
        />
      ) : (
        <div>
          {canCreate && (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px 0" }}>
              <Link to="/activities/new" style={newButtonStyle}>+ New activity</Link>
            </div>
          )}

          {items.map(a => <ActivityRow key={a.activityId} activity={a} />)}

          {data && data.total > skip + items.length && (
            <div style={{ padding: 16, textAlign: "center" }}>
              <button type="button" onClick={() => setSkip(skip + TAKE)} style={loadMoreStyle}>
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity: a }: { activity: ActivityListItem }) {
  return (
    <div style={rowStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{a.activityName}</div>
          <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
            {a.activityDate ? shortDate(a.activityDate) : "No date recorded"}
          </div>
          {a.description && (
            <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 6, lineHeight: 1.5 }}>
              {a.description}
            </div>
          )}
        </div>
        <span style={a.isClosed ? closedPillStyle : openPillStyle}>{a.isClosed ? "Closed" : "Open"}</span>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <div>
          <div style={totalLabelStyle}>Funded</div>
          <div className="num in" style={totalValueStyle}>{peso(a.fundedTotal)}</div>
        </div>
        <div>
          <div style={totalLabelStyle}>Spent</div>
          <div className="num out" style={totalValueStyle}>{peso(a.spentTotal)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <Link to={`/donations?activityId=${a.activityId}`} style={linkChipStyle}>See donations</Link>
        <Link to={`/expenses?activityId=${a.activityId}`} style={linkChipStyle}>See expenses</Link>
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  padding: 14, background: "var(--paper)", borderBottom: "1px solid var(--line)",
};

const totalLabelStyle: CSSProperties = {
  fontSize: 10.5, color: "var(--mute)", letterSpacing: ".06em", textTransform: "uppercase",
};

const totalValueStyle: CSSProperties = { fontSize: 15, fontWeight: 600, marginTop: 2 };

const pillBase: CSSProperties = {
  display: "inline-block", fontSize: 10.5, padding: "2px 8px", borderRadius: 10, flex: "none",
};

const openPillStyle: CSSProperties = {
  ...pillBase, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const closedPillStyle: CSSProperties = {
  ...pillBase, background: "var(--deep)", color: "var(--brass-soft)",
};

const linkChipStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 34, padding: "0 12px",
  borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)",
  color: "var(--info)", fontSize: 12.5, textDecoration: "none",
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
