import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteComms } from "@/shared/roles";
import type { Announcement } from "@/shared/types";

const TAKE = 25;

function excerpt(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/**
 * GET /api/chapters/{chapterId}/announcements?skip=&take=&includeWithdrawn= — newest
 * first (the backend orders this). Empty state: a brand-new chapter with nothing
 * posted yet.
 *
 * Officers can flip on "Show withdrawn" (?includeWithdrawn=true) to review the
 * withdrawal history and its reasons; plain members only ever see the live feed —
 * that toggle simply isn't rendered for them.
 */
export function AnnouncementList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteComms(roles);

  const [skip, setSkip] = useState(0);
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["announcements", chapterId, skip, includeWithdrawn],
    queryFn: () => api.get<Paged<Announcement>>(
      `/api/chapters/${chapterId}/announcements?skip=${skip}&take=${TAKE}` +
      (includeWithdrawn ? "&includeWithdrawn=true" : "")),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];
  // Urgent, still-live posts read first — a blood or assistance request is the
  // reason someone opened this screen. A withdrawn post never jumps the queue,
  // even if it was urgent while it was live.
  const ordered = [...items].sort((a, b) => Number(b.isUrgent && !b.isWithdrawn) - Number(a.isUrgent && !a.isWithdrawn));

  const newButton = isOfficer
    ? <Link to="/announcements/new" style={newButtonStyle}>+ New announcement</Link>
    : undefined;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px 0" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={chipOnStyle}>Announcements</span>
          <Link to="/memos" style={chipStyle}>Memos</Link>
        </div>
        {newButton}
      </div>

      {isOfficer && (
        <label style={toggleRowStyle}>
          <input
            type="checkbox" checked={includeWithdrawn}
            onChange={e => { setIncludeWithdrawn(e.target.checked); setSkip(0); }}
          />
          <span>Show withdrawn announcements</span>
        </label>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Nothing posted yet"
          body="Once your chapter posts an announcement, it appears here for everyone to see."
        />
      ) : (
        <div>
          {ordered.map(a => <AnnouncementRow key={a.announcementId} announcement={a} />)}

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

function AnnouncementRow({ announcement: a }: { announcement: Announcement }) {
  const isLiveUrgent = a.isUrgent && !a.isWithdrawn;

  return (
    <Link to={`/announcements/${a.announcementId}`} style={rowStyle}>
      <div style={{
        width: 38, height: 38, borderRadius: 8, flex: "none",
        display: "grid", placeItems: "center", fontFamily: "var(--f-disp)", fontSize: 16,
        background: isLiveUrgent ? "#FBF4E4" : "var(--brass-soft)",
        color: isLiveUrgent ? "var(--warn)" : "var(--brass-dk)",
      }}>
        {isLiveUrgent ? "!" : "📣"}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
          {shortDate(a.publishDateUtc)}
          {a.editedDateUtc && " · Edited"}
        </div>

        {a.isWithdrawn ? (
          <div style={withdrawnBannerStyle}>
            Withdrawn{a.withdrawnReason ? ` — ${a.withdrawnReason}` : ""}
          </div>
        ) : (
          <>
            {isLiveUrgent && (
              <span style={urgentPillStyle}>
                {a.urgentTypeName === "BloodRequest"
                  ? `Urgent · blood request${a.bloodTypeName ? ` · ${a.bloodTypeName}` : ""}`
                  : "Urgent · assistance needed"}
              </span>
            )}
            <div style={excerptStyle}>{excerpt(a.body)}</div>
          </>
        )}
      </div>
    </Link>
  );
}

const rowStyle: CSSProperties = {
  display: "flex", gap: 12, alignItems: "flex-start", padding: 12,
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const excerptStyle: CSSProperties = {
  fontSize: 12.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.5,
};

const urgentPillStyle: CSSProperties = {
  display: "inline-block", marginTop: 5, fontSize: 10.5, padding: "2px 8px", borderRadius: 10,
  background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8",
};

const withdrawnBannerStyle: CSSProperties = {
  marginTop: 4, fontSize: 12.5, color: "var(--mute)", fontStyle: "italic", lineHeight: 1.5,
};

const newButtonStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0 14px",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em",
  textTransform: "uppercase", textDecoration: "none",
};

const chipBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 30, padding: "0 12px",
  borderRadius: 16, fontSize: 12.5, textDecoration: "none",
};

const chipStyle: CSSProperties = {
  ...chipBase, border: "1px solid var(--line)", color: "var(--slate)", background: "var(--paper)",
};

const chipOnStyle: CSSProperties = {
  ...chipBase, background: "var(--deep)", color: "var(--brass-soft)",
};

const toggleRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "12px 16px 0",
  fontSize: 12.5, color: "var(--slate)", minHeight: "var(--tap)",
};

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
