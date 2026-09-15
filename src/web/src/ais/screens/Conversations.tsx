import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import type { ConversationSummary } from "@/shared/types";

const TAKE = 50;

/**
 * The caller's own private-message inbox, at /conversations.
 *
 * Endpoint: GET /api/conversations?skip=&take= — the caller's own DM rooms,
 * newest-activity-first (the backend orders this, never re-sorted here).
 *
 * Empty state: a member who has never started a private conversation — the normal
 * state for most members most of the time, not an error.
 *
 * Muting is fire-and-forget with an optimistic flip, the same low-stakes posture
 * ChatRoom.tsx's own read-cursor/flag calls use — a missed toggle is invisible and
 * never worth a banner, but a failed one is still reverted so this row never lies
 * about whether it's actually muted.
 */
export function Conversations() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<Paged<ConversationSummary>>(`/api/conversations?skip=0&take=${TAKE}`),
  });

  const [muting, setMuting] = useState<Set<number>>(new Set());
  const [localMute, setLocalMute] = useState<Record<number, boolean>>({});

  async function toggleMute(roomId: number, currentlyMuted: boolean) {
    setMuting(prev => new Set(prev).add(roomId));
    setLocalMute(prev => ({ ...prev, [roomId]: !currentlyMuted }));
    try {
      await api.post(`/api/conversations/${roomId}/mute`, { isMuted: !currentlyMuted });
    } catch {
      // Revert the optimistic flip — this toggle must never claim a mute succeeded
      // when the write actually failed.
      setLocalMute(prev => ({ ...prev, [roomId]: currentlyMuted }));
    } finally {
      setMuting(prev => { const next = new Set(prev); next.delete(roomId); return next; });
    }
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        body="Start one from a brother's profile in the directory."
        action={<Link to="/members" style={emptyActionStyle}>Go to Members</Link>}
      />
    );
  }

  return (
    <div>
      <div style={headerStyle}>
        <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 19, letterSpacing: ".03em" }}>Messages</h1>
      </div>

      {items.map(c => {
        const isMuted = localMute[c.roomId] ?? c.isMuted;
        return (
          <div key={c.roomId} style={rowStyle}>
            <Link
              to={`/conversations/${c.roomId}`}
              state={{ summary: c }}
              style={rowLinkStyle}
            >
              <div style={avatarStyle}>{c.otherGiftName.slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{c.otherGiftName}</span>
                  {c.lastMessageDate && <span style={dateStyle}>{shortDate(c.lastMessageDate)}</span>}
                </div>
                {c.otherChapterName && <div style={chapterStyle}>{c.otherChapterName}</div>}
                <div style={previewStyle}>{c.lastMessagePreview ?? "No messages yet"}</div>
              </div>
              {c.unreadCount > 0 && <span style={unreadBadgeStyle}>{c.unreadCount}</span>}
            </Link>
            <button
              type="button"
              aria-label={isMuted
                ? `Turn message alerts back on for ${c.otherGiftName}`
                : `Mute message alerts for ${c.otherGiftName}`}
              onClick={() => { void toggleMute(c.roomId, isMuted); }}
              disabled={muting.has(c.roomId)}
              style={muteButtonStyle}
            >
              {isMuted ? "🔕" : "🔔"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

const headerStyle: CSSProperties = {
  padding: "14px 16px 10px", borderBottom: "1px solid var(--line)",
};

const rowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
};

const rowLinkStyle: CSSProperties = {
  flex: 1, minWidth: 0, display: "flex", gap: 12, alignItems: "center", padding: 12,
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const avatarStyle: CSSProperties = {
  width: 40, height: 40, borderRadius: 8, flex: "none", background: "var(--deep)",
  color: "var(--brass-soft)", display: "grid", placeItems: "center",
  fontFamily: "var(--f-disp)", fontSize: 16,
};

const dateStyle: CSSProperties = { flex: "none", fontSize: 11, color: "var(--mute)" };

const chapterStyle: CSSProperties = { fontSize: 11.5, color: "var(--mute)", marginTop: 1 };

const previewStyle: CSSProperties = {
  fontSize: 12.5, color: "var(--slate)", marginTop: 3, lineHeight: 1.4,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const unreadBadgeStyle: CSSProperties = {
  flex: "none", minWidth: 20, height: 20, borderRadius: 10, padding: "0 6px",
  background: "var(--out)", color: "var(--paper)", fontSize: 11, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "var(--f-num)",
};

const muteButtonStyle: CSSProperties = {
  flex: "none", width: "var(--tap)", height: "var(--tap)", fontSize: 17,
  display: "flex", alignItems: "center", justifyContent: "center",
};

const emptyActionStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: "var(--tap)", padding: "0 18px",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em",
  textTransform: "uppercase", textDecoration: "none",
};
