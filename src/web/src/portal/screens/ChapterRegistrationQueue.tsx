import { useEffect, useState, type CSSProperties } from "react";
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
 * GET /api/chapter-registrations?statusId=&search=&skip=&take= — a council officer's own review
 * queue. NO councilId anywhere in the route: scoped entirely to the councils the caller
 * is seated on, server-side (ICurrentUser.CouncilIds via
 * usp_ChapterRegistration_GetQueue's own @RequestingMemberId derivation, never anything
 * this screen supplies — CLAUDE.md invariant #4/#11).
 *
 * canReviewChapterRegistrations (CouncilSecretary or CouncilAdmin) gates the whole
 * screen — anyone else sees a plain "you don't have access" state, same pattern as
 * ApplicationQueue's own canApproveApplications gate.
 *
 * The search box narrows the SAME scoped queue by chapter name, reference number, or an
 * officer named on the filing (gift name, name, member number) — matched server-side in
 * usp_ChapterRegistration_GetQueue. It never widens what the caller can see. Kept in the
 * URL (?q=) so a filtered view survives a refresh or a back-navigation from a detail page.
 */
export function ChapterRegistrationQueue() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canReview = canReviewChapterRegistrations(roles);

  const [searchParams, setSearchParams] = useSearchParams();
  const statusId = searchParams.get("statusId") ?? "";
  const search = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const [skip, setSkip] = useState(0);

  // Wait for a short pause in typing before querying — one request per thought, not per
  // keystroke, on a slow mobile connection.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set("q", trimmed); else next.delete("q");
      setSearchParams(next, { replace: true });
      setSkip(0);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput, search, searchParams, setSearchParams]);

  const qs = new URLSearchParams();
  qs.set("skip", String(skip));
  qs.set("take", String(TAKE));
  if (statusId) qs.set("statusId", statusId);
  if (search) qs.set("search", search);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["chapter-registrations", statusId, search, skip],
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
        <input
          type="search" aria-label="Search chapter or member"
          placeholder="Search chapter, member or reference no."
          value={searchInput} onChange={e => setSearchInput(e.target.value)}
          maxLength={100} style={searchFieldStyle}
        />
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

      {isLoading ? (
        <ScreenSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        search ? (
          <EmptyState
            title="No matches"
            body={`No chapter or member matching "${search}" in your council's registrations. Check the spelling, or try a gift name or member number.`}
          />
        ) : (
          <EmptyState
            title="Nothing to review right now"
            body="Once a chapter petitions or files its annual officer update, it appears here."
          />
        )
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

const filterRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0" };

const searchFieldStyle: CSSProperties = {
  flex: "1 1 260px", minHeight: 40, padding: "0 12px", borderRadius: 8, fontSize: 13.5,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

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
