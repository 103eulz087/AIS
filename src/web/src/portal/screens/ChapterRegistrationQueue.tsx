import { useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canReviewChapterRegistrations } from "@/shared/roles";
import {
  CHAPTER_REGISTRATION_STATUSES, type ChapterRegistrationQueueItem, type ChapterRegistrationStatusName,
} from "@/shared/types";

const TAKE = 25;

function statusLabel(name: ChapterRegistrationStatusName | string): string {
  switch (name) {
    case "Submitted": return "Submitted";
    case "ReturnedForCorrection": return "Returned for correction";
    case "Approved": return "Approved";
    default: return name;
  }
}

function typeLabel(name: string): string {
  return name === "Charter" ? "New chapter" : "Officer update";
}

/**
 * GET /api/chapter-registrations?statusId=&skip=&take= — a council officer's own review
 * queue. NO councilId anywhere in the route: scoped entirely to the councils the caller
 * is seated on, server-side (ICurrentUser.CouncilIds via
 * usp_ChapterRegistration_GetQueue's own @RequestingMemberId derivation, never anything
 * this screen supplies — CLAUDE.md invariant #4/#11).
 *
 * canReviewChapterRegistrations (CouncilSecretary or CouncilAdmin) gates the whole
 * screen — anyone else sees a plain "you don't have access" state, same pattern as
 * ApplicationQueue's own canApproveApplications gate.
 */
export function ChapterRegistrationQueue() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canReview = canReviewChapterRegistrations(roles);

  const [searchParams, setSearchParams] = useSearchParams();
  const statusId = searchParams.get("statusId") ?? "";
  const [skip, setSkip] = useState(0);

  const qs = new URLSearchParams();
  qs.set("skip", String(skip));
  qs.set("take", String(TAKE));
  if (statusId) qs.set("statusId", statusId);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["chapter-registrations", statusId, skip],
    queryFn: () => api.get<Paged<ChapterRegistrationQueueItem>>(`/api/chapter-registrations?${qs.toString()}`),
    enabled: canReview,
  });

  if (!canReview) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a council secretary or council admin can review chapter registrations."
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
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>
        Chapter registrations
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        New chapter petitions and annual officer updates awaiting your council.
      </p>

      <div style={filterRowStyle}>
        <select
          aria-label="Filter by status" value={statusId}
          onChange={e => updateStatusFilter(e.target.value)} style={filterFieldStyle}
        >
          <option value="">All statuses</option>
          {CHAPTER_REGISTRATION_STATUSES.map(s => (
            <option key={s.id} value={s.id}>{statusLabel(s.name)}</option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing to review right now"
          body="Once a chapter petitions or files its annual officer update, it appears here."
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Chapter</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.registrationId}>
                  <td style={tdStyle}>
                    <Link to={`/portal/chapter-registrations/${r.registrationId}`} style={linkStyle} className="num">
                      {r.referenceNo}
                    </Link>
                  </td>
                  <td style={tdStyle}>{typeLabel(r.registrationType)}</td>
                  <td style={tdStyle}>{r.chapterName ?? r.proposedChapterName ?? "—"}</td>
                  <td style={tdStyle}><span style={statusPillStyle(r.statusName)}>{statusLabel(r.statusName)}</span></td>
                  <td style={tdStyle}>{shortDate(r.submittedDateUtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>

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

function statusPillStyle(statusName: string): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block", fontSize: 11, padding: "3px 9px", borderRadius: 10, whiteSpace: "nowrap",
  };
  switch (statusName) {
    case "Submitted":
      return { ...base, background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8" };
    case "Approved":
      return { ...base, background: "var(--bond)", color: "var(--in)", border: "1px solid var(--line)" };
    case "ReturnedForCorrection":
      return { ...base, background: "var(--bond)", color: "var(--out)", border: "1px solid var(--line)" };
    default:
      return { ...base, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)" };
  }
}

const filterRowStyle: CSSProperties = { display: "flex", gap: 8, margin: "16px 0" };

const filterFieldStyle: CSSProperties = {
  minWidth: 220, minHeight: 40, padding: "0 10px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)", minWidth: 640,
};

const thStyle: CSSProperties = {
  textAlign: "left", fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};

const linkStyle: CSSProperties = { color: "var(--info)", textDecoration: "none" };

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
