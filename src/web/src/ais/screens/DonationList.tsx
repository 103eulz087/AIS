import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { pesoSigned, shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteDonations } from "@/shared/roles";
import type { ActivityListItem, DonationListItem } from "@/shared/types";
import { FundsTabs } from "./FundsTabs";

const TAKE = 25;

/**
 * GET /api/chapters/{chapterId}/donations?skip=&take=&activityId=&includeVoided= —
 * newest first (the backend orders this). Empty state: a brand-new chapter (or a
 * filter combination) with nothing recorded yet.
 *
 * This is the module's strongest transparency artifact: a donor's name and amount
 * are meant to be seen, unlike a meeting's per-member contribution. What is NEVER
 * shown, here or anywhere in this module, is a per-donor running total, a donor
 * leaderboard, or any ranking/sort by amount — each donation stands alone. A voided
 * donation is never hidden; it renders as a normal historical row with its void
 * reason shown underneath, same posture as a voided expense.
 */
export function DonationList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canCreate = canWriteDonations(roles);

  const [searchParams, setSearchParams] = useSearchParams();
  const activityId = searchParams.get("activityId") ?? "";
  const [includeVoided, setIncludeVoided] = useState(false);
  const [skip, setSkip] = useState(0);

  const activities = useQuery({
    queryKey: ["activities-for-filter", chapterId],
    queryFn: () => api.get<Paged<ActivityListItem>>(`/api/chapters/${chapterId}/activities?take=500`),
  });

  const qs = new URLSearchParams();
  qs.set("skip", String(skip));
  qs.set("take", String(TAKE));
  if (activityId) qs.set("activityId", activityId);
  if (includeVoided) qs.set("includeVoided", "true");

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["donations", chapterId, activityId, includeVoided, skip],
    queryFn: () => api.get<Paged<DonationListItem>>(`/api/chapters/${chapterId}/donations?${qs.toString()}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  function updateActivityFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("activityId", value); else next.delete("activityId");
    setSearchParams(next);
    setSkip(0);
  }

  return (
    <div>
      <FundsTabs active="donations" />

      <div style={filterRowStyle}>
        <select
          aria-label="Filter by activity" value={activityId}
          onChange={e => updateActivityFilter(e.target.value)} style={filterFieldStyle}
        >
          <option value="">All activities</option>
          {(activities.data?.items ?? []).map(a => (
            <option key={a.activityId} value={a.activityId}>{a.activityName}</option>
          ))}
        </select>
      </div>

      {canCreate && (
        <label style={toggleRowStyle}>
          <input
            type="checkbox" checked={includeVoided}
            onChange={e => { setIncludeVoided(e.target.checked); setSkip(0); }}
          />
          <span>Show voided donations</span>
        </label>
      )}

      {canCreate && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px 0" }}>
          <Link to="/donations/new" style={newButtonStyle}>+ New donation</Link>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No donations recorded yet"
          body="Once your chapter's treasurer records a donation, it appears here with the donor's name."
        />
      ) : (
        <div>
          {items.map(d => <DonationRow key={d.donationId} donation={d} />)}

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

function DonationRow({ donation: d }: { donation: DonationListItem }) {
  return (
    <Link to={`/donations/${d.donationId}`} style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{d.donorName}</div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
          {shortDate(d.donationDate)}
          {d.donorType ? ` · ${d.donorType}` : ""}
          {d.activityName ? ` · ${d.activityName}` : ""}
        </div>
        {d.isVoided && <div style={voidedNoteStyle}>Voided — see detail for the reason</div>}
      </div>

      {/* isInKind is an explicit field — never inferred from amount === 0. A ₱0 in-kind
          row must never render as a peso amount. */}
      {d.isInKind ? (
        <div style={{ textAlign: "right", flex: "none", maxWidth: 160 }}>
          <div style={{ fontSize: 12.5, color: "var(--slate)", fontStyle: "italic" }}>
            In kind — {d.inKindDescription}
          </div>
          {d.amount > 0 && (
            <div className="num in" style={{ fontSize: 12, marginTop: 2 }}>{pesoSigned(d.amount, "In")}</div>
          )}
        </div>
      ) : (
        <div className="num in" style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>
          {pesoSigned(d.amount, "In")}
        </div>
      )}
    </Link>
  );
}

const rowStyle: CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", padding: 12,
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const filterRowStyle: CSSProperties = { display: "flex", gap: 8, padding: "12px 16px 0" };

const filterFieldStyle: CSSProperties = {
  flex: 1, minHeight: 40, padding: "0 10px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const toggleRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "12px 16px 0",
  fontSize: 12.5, color: "var(--slate)", minHeight: "var(--tap)",
};

const voidedNoteStyle: CSSProperties = {
  marginTop: 4, fontSize: 12, color: "var(--mute)", fontStyle: "italic",
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
