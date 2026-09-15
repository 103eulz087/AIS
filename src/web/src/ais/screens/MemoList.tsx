import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteComms } from "@/shared/roles";
import type { Memo } from "@/shared/types";

const TAKE = 25;

/**
 * GET /api/chapters/{chapterId}/memos — newest first (the backend orders this).
 * Empty state: a brand-new chapter with no memo of record yet.
 *
 * A memo is a formal, numbered document. Unlike an announcement, it is never
 * edited — no "Edited" mark is ever rendered here, because that field doesn't
 * exist on this model. A correction shows as a dim "Superseded by MEMO-…" banner,
 * never a disappearance: the old memo stays on the record.
 */
export function MemoList({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteComms(roles);

  const [skip, setSkip] = useState(0);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["memos", chapterId, skip],
    queryFn: () => api.get<Paged<Memo>>(`/api/chapters/${chapterId}/memos?skip=${skip}&take=${TAKE}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const items = data?.items ?? [];

  const newButton = isOfficer
    ? <Link to="/memos/new" style={newButtonStyle}>+ New memo</Link>
    : undefined;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px 0" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Link to="/announcements" style={chipStyle}>Announcements</Link>
          <span style={chipOnStyle}>Memos</span>
        </div>
        {newButton}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No memoranda on record yet"
          body="Once your chapter publishes a memo, it appears here with its own number, permanently."
        />
      ) : (
        <div>
          {items.map(m => (
            <Link key={m.memoId} to={`/memos/${m.memoId}`} style={rowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="num" style={{ fontSize: 11, color: "var(--brass-dk)", letterSpacing: ".04em" }}>
                  {m.memoNumber}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{m.subject}</div>
                <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
                  {shortDate(m.publishDateUtc)}
                </div>
                {m.isSuperseded && (
                  <div style={supersededBannerStyle}>
                    Superseded by {m.supersededByMemoNumber ?? "a later memo"}
                  </div>
                )}
              </div>
              <span style={{ color: "var(--mute)", flex: "none" }}>›</span>
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
      )}
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex", gap: 12, alignItems: "flex-start", padding: 12,
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const supersededBannerStyle: CSSProperties = {
  marginTop: 5, fontSize: 12, color: "var(--mute)", fontStyle: "italic",
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

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
