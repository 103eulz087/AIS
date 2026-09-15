import { useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canApproveApplications } from "@/shared/roles";
import { MEMBERSHIP_APPLICATION_STATUSES, type MembershipApplicationQueueItem } from "@/shared/types";

const TAKE = 25;

/**
 * GET /api/membership-applications?statusId=&skip=&take= — a Chapter Admin's own
 * review queue. No chapterId anywhere in the route: the server scopes this to the
 * caller's own chapter from the JWT (CLAUDE.md invariant #4/#11), never from anything
 * this screen supplies. Newest first (the server orders this).
 *
 * ChapterAdmin-only — a plain member or another officer sees a plain "you don't have
 * access" state rather than a 403 crash, mirroring ExpenseNew's own gating.
 */
export function ApplicationQueue() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];

  const [searchParams, setSearchParams] = useSearchParams();
  const statusId = searchParams.get("statusId") ?? "";
  const [skip, setSkip] = useState(0);

  const qs = new URLSearchParams();
  qs.set("skip", String(skip));
  qs.set("take", String(TAKE));
  if (statusId) qs.set("statusId", statusId);

  const canApprove = canApproveApplications(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["membership-applications", statusId, skip],
    queryFn: () => api.get<Paged<MembershipApplicationQueueItem>>(`/api/membership-applications?${qs.toString()}`),
    enabled: canApprove,
  });

  if (!canApprove) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter admin can review membership applications."
      />
    );
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  function updateStatusFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("statusId", value); else next.delete("statusId");
    setSearchParams(next);
    setSkip(0);
  }

  return (
    <div>
      <div style={{ padding: "16px 16px 0" }}>
        <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".03em" }}>
          Membership applications
        </h1>
      </div>

      <div style={filterRowStyle}>
        <select
          aria-label="Filter by status" value={statusId}
          onChange={e => updateStatusFilter(e.target.value)} style={filterFieldStyle}
        >
          <option value="">All statuses</option>
          {MEMBERSHIP_APPLICATION_STATUSES.map(s => (
            <option key={s.id} value={s.id}>{statusLabel(s.name)}</option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No applications to show"
          body="Once someone applies to join this chapter, their application appears here."
        />
      ) : (
        <div>
          {items.map(a => <QueueRow key={a.applicationId} item={a} />)}

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

function statusLabel(name: string): string {
  switch (name) {
    case "PendingApproval": return "Pending approval";
    case "ReturnedForCorrection": return "Returned for correction";
    case "Approved": return "Approved";
    case "Rejected": return "Rejected";
    default: return name;
  }
}

function QueueRow({ item: a }: { item: MembershipApplicationQueueItem }) {
  return (
    <Link to={`/applications/${a.applicationId}`} style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{a.giftName}</div>
        <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 2 }}>
          {a.firstName} {a.lastName}
        </div>
        <div className="num" style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
          {a.mobileNo}
        </div>
      </div>
      <div style={{ flex: "none", textAlign: "right" }}>
        <span style={statusPillStyle(a.statusName)}>{statusLabel(a.statusName)}</span>
        <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 6 }}>{shortDate(a.submittedDateUtc)}</div>
      </div>
    </Link>
  );
}

function statusPillStyle(statusName: string): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block", fontSize: 10.5, padding: "3px 9px", borderRadius: 10, whiteSpace: "nowrap",
  };
  switch (statusName) {
    case "PendingApproval":
      return { ...base, background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8" };
    case "Approved":
      return { ...base, background: "var(--bond)", color: "var(--in)", border: "1px solid var(--line)" };
    case "Rejected":
      return { ...base, background: "var(--bond)", color: "var(--out)", border: "1px solid var(--line)" };
    default:
      return { ...base, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)" };
  }
}

const rowStyle: CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", padding: 12,
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const filterRowStyle: CSSProperties = { display: "flex", gap: 8, padding: "12px 16px" };

const filterFieldStyle: CSSProperties = {
  flex: 1, minHeight: 40, padding: "0 10px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
