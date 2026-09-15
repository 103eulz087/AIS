import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { pesoSigned, shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteExpenses } from "@/shared/roles";
import { EXPENSE_CATEGORIES, type ActivityListItem, type ExpenseListItem } from "@/shared/types";
import { FundsTabs } from "./FundsTabs";

const TAKE = 25;

/**
 * GET /api/chapters/{chapterId}/expenses?skip=&take=&activityId=&categoryId=&includeVoided=
 * — newest first (the backend orders this). Empty state: a brand-new chapter (or a
 * filter combination) with nothing recorded yet.
 *
 * A voided expense is never hidden by default toggling to a scary state — it renders
 * as a normal historical row with its void reason shown plainly underneath, the same
 * "never a silent disappearance" posture as a withdrawn announcement. Only officers
 * (ChapterTreasurer/ChapterAdmin) get the "Show voided" toggle at all; a plain member
 * simply doesn't see the control, matching the includeWithdrawn pattern in
 * AnnouncementList.
 */
export function ExpenseList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canCreate = canWriteExpenses(roles);

  const [searchParams, setSearchParams] = useSearchParams();
  const activityId = searchParams.get("activityId") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
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
  if (categoryId) qs.set("categoryId", categoryId);
  if (includeVoided) qs.set("includeVoided", "true");

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["expenses", chapterId, activityId, categoryId, includeVoided, skip],
    queryFn: () => api.get<Paged<ExpenseListItem>>(`/api/chapters/${chapterId}/expenses?${qs.toString()}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  function updateFilter(key: "activityId" | "categoryId", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
    setSkip(0);
  }

  return (
    <div>
      <FundsTabs active="expenses" />

      <div style={filterRowStyle}>
        <select
          aria-label="Filter by activity" value={activityId}
          onChange={e => updateFilter("activityId", e.target.value)} style={filterFieldStyle}
        >
          <option value="">All activities</option>
          {(activities.data?.items ?? []).map(a => (
            <option key={a.activityId} value={a.activityId}>{a.activityName}</option>
          ))}
        </select>

        <select
          aria-label="Filter by category" value={categoryId}
          onChange={e => updateFilter("categoryId", e.target.value)} style={filterFieldStyle}
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {canCreate && (
        <label style={toggleRowStyle}>
          <input
            type="checkbox" checked={includeVoided}
            onChange={e => { setIncludeVoided(e.target.checked); setSkip(0); }}
          />
          <span>Show voided expenses</span>
        </label>
      )}

      {canCreate && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px 0" }}>
          <Link to="/expenses/new" style={newButtonStyle}>+ New expense</Link>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No expenses recorded yet"
          body="Once your chapter's treasurer records an expense with its receipt, it appears here."
        />
      ) : (
        <div>
          {items.map(x => <ExpenseRow key={x.expenseId} expense={x} />)}

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

function ExpenseRow({ expense: x }: { expense: ExpenseListItem }) {
  return (
    <Link to={`/expenses/${x.expenseId}`} style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{x.payee}</div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
          {shortDate(x.expenseDate)}
          {x.categoryName ? ` · ${x.categoryName}` : ""}
          {x.activityName ? ` · ${x.activityName}` : ""}
        </div>
        {x.description && (
          <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 4 }}>{x.description}</div>
        )}
        {x.isVoided && <div style={voidedNoteStyle}>Voided — see detail for the reason</div>}
      </div>
      <div className="num out" style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>
        {pesoSigned(x.amount, "Out")}
      </div>
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
