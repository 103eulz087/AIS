import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { useChatConnection } from "@/shared/chat-connection";
import type { ChatMessage, ConversationSummary } from "@/shared/types";

const PAGE_SIZE = 50;
const MAX_BODY_LENGTH = 2000;

interface ConversationLocationState {
  summary?: ConversationSummary;
}

/**
 * A single private (one-to-one) conversation, at /conversations/{roomId}.
 *
 * Endpoints:
 *  - GET  /api/conversations/{roomId}/messages?beforeMessageId=&take=  — newest first
 *    from the server; reversed here to oldest-first for display, same as ChatRoom.tsx.
 *  - POST /api/conversations/{roomId}/messages                        — {body}. The
 *    posted message is added to the list from THIS call's response, never optimistically.
 *  - POST /api/conversations/{roomId}/read                            — {lastReadMessageId}.
 *    Fire-and-forget, same low-stakes posture as ChatRoom.tsx's own read-cursor call.
 *  - POST /api/conversations/{roomId}/mute                            — {isMuted}.
 *  - SignalR /hubs/chat — "PrivateMessagePosted", filtered to this room (see
 *    otherMemberId below — the DTO itself carries no RoomId).
 *
 * Deliberately UNLIKE ChatRoom.tsx: no flag, no remove, no moderation queue link, no
 * tombstone rendering. Private messages are unmoderated by design this slice — there
 * is no affordance anywhere on this screen to hide or remove one.
 *
 * The header (other participant's gift name/chapter/mute state) comes from router
 * state when navigated here from Conversations.tsx or from starting a new
 * conversation in MemberDirectory.tsx — both already have it from their own API
 * calls. Reached any other way (a push-notification tap, a bookmarked/shared link, a
 * page refresh), it falls back to the caller's own conversation list, the same GET
 * /api/conversations Conversations.tsx reads — no new endpoint for this.
 *
 * States: loading (skeleton) / not-found (a plain "not available" empty state, no
 * retry — same reasoning as routes.tsx's ChatRoomForCurrentChapter: retrying an
 * anti-enumeration 404 can never succeed) / error (one sentence + Retry) / empty
 * ("no messages yet") / loaded.
 */
export function Conversation() {
  const { roomId: roomIdParam } = useParams<{ roomId: string }>();
  const roomId = Number(roomIdParam);
  const location = useLocation();
  const passedSummary = (location.state as ConversationLocationState | null)?.summary;
  const { claims } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [muted, setMuted] = useState<boolean | null>(passedSummary ? passedSummary.isMuted : null);
  const [muting, setMuting] = useState(false);

  const { status, connection } = useChatConnection(claims?.chapterId ?? 0);
  const listEndRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitially = useRef(false);
  const lastMarkedMessageId = useRef<number | null>(null);

  // Only fetched when this screen arrived with no router state to fall back on —
  // see this screen's own header comment.
  const listQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<Paged<ConversationSummary>>("/api/conversations?skip=0&take=100"),
    enabled: !passedSummary,
  });
  const foundSummary = listQuery.data?.items.find(c => c.roomId === roomId);
  const summary = passedSummary ?? foundSummary;

  useEffect(() => {
    if (muted === null && summary) setMuted(summary.isMuted);
  }, [muted, summary]);

  // The other participant's own member id — the ONLY way to tell which incoming
  // "PrivateMessagePosted" broadcasts belong to THIS room, since the DTO itself
  // carries no RoomId (see ConversationsEndpoints.PostMessage's own header comment:
  // a private room has no chapter group to key a broadcast off, so it goes straight
  // to both participants' own member-{id} groups instead — which also receive every
  // OTHER private room's events for this same member). A private room is unique per
  // pair, so "sent by this room's other participant" is exactly "belongs to this
  // room" for anything arriving here.
  const otherMemberId = summary?.otherMemberId
    ?? messages?.find(m => m.senderId !== claims?.memberId)?.senderId
    ?? null;

  const merge = useCallback((incoming: ChatMessage) => {
    setMessages(prev => {
      if (!prev) return prev;
      const existingIndex = prev.findIndex(m => m.messageId === incoming.messageId);
      if (existingIndex === -1) return [...prev, incoming];
      const next = prev.slice();
      next[existingIndex] = incoming;
      return next;
    });
  }, []);

  const loadInitial = useCallback(async (cancelled: () => boolean) => {
    setLoadError(null);
    try {
      const rows = await api.get<ChatMessage[]>(
        `/api/conversations/${roomId}/messages?take=${PAGE_SIZE}`);
      if (cancelled()) return;
      setMessages([...rows].reverse());
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      if (cancelled()) return;
      setMessages(null);
      if (err instanceof ApiError && err.status === 404) {
        setLoadError({ message: "This conversation isn't available.", notFound: true });
      } else {
        setLoadError({
          message: err instanceof ApiError ? err.message : "Check your connection and try again.",
          notFound: false,
        });
      }
    }
  }, [roomId]);

  useEffect(() => {
    let isCancelled = false;
    void loadInitial(() => isCancelled);
    return () => { isCancelled = true; };
  }, [loadInitial, reloadToken]);

  useEffect(() => {
    if (messages && messages.length > 0 && !hasScrolledInitially.current) {
      hasScrolledInitially.current = true;
      listEndRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [messages]);

  // Same "mark newest visible message read" pattern as ChatRoom.tsx — once after
  // initial load, again each time a new message merges in, never twice for the same
  // message. Fire-and-forget and silent on failure, same low-stakes reasoning.
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (!newest) return;
    if (lastMarkedMessageId.current !== null && newest.messageId <= lastMarkedMessageId.current) return;
    lastMarkedMessageId.current = newest.messageId;
    api.post(`/api/conversations/${roomId}/read`, { lastReadMessageId: newest.messageId }).catch(() => {
      // Best-effort only — see this screen's own header comment.
    });
  }, [messages, roomId]);

  useEffect(() => {
    if (!connection || otherMemberId === null) return;
    const onPosted = (dto: ChatMessage) => {
      if (dto.senderId !== otherMemberId) return; // Belongs to a different conversation.
      merge(dto);
    };
    connection.on("PrivateMessagePosted", onPosted);
    return () => connection.off("PrivateMessagePosted", onPosted);
  }, [connection, merge, otherMemberId]);

  async function loadEarlier() {
    const oldest = messages?.[0];
    if (!oldest) return;
    setMoreError(null);
    setLoadingMore(true);
    try {
      const rows = await api.get<ChatMessage[]>(
        `/api/conversations/${roomId}/messages?beforeMessageId=${oldest.messageId}&take=${PAGE_SIZE}`);
      setMessages(prev => [...[...rows].reverse(), ...(prev ?? [])]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : "Could not load earlier messages. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_BODY_LENGTH || status === "offline") return;

    setSendError(null);
    setSending(true);
    try {
      const posted = await api.post<ChatMessage>(`/api/conversations/${roomId}/messages`, { body: trimmed });
      merge(posted);
      setBody("");
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Could not send that message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleMuteToggle() {
    if (muted === null) return;
    const next = !muted;
    setMuting(true);
    setMuted(next);
    try {
      await api.post(`/api/conversations/${roomId}/mute`, { isMuted: next });
    } catch {
      setMuted(!next); // Revert — this toggle must never claim a mute that didn't take.
    } finally {
      setMuting(false);
    }
  }

  if (messages === null && !loadError) return <ScreenSkeleton rows={6} />;

  if (loadError?.notFound) {
    return (
      <EmptyState
        title="This conversation isn't available"
        body="You may have followed an old link, or something about this conversation has changed. Go back to your messages and try again."
        action={<Link to="/conversations" style={backLinkStyle}>Back to Messages</Link>}
      />
    );
  }

  if (loadError) {
    return <ErrorState message={loadError.message} onRetry={() => setReloadToken(t => t + 1)} />;
  }

  const rows = messages ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "70vh" }}>
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Link to="/conversations" aria-label="Back to Messages" style={backArrowStyle}>‹</Link>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 18, letterSpacing: ".03em" }}>
              {summary?.otherGiftName ?? "Conversation"}
            </h1>
            {summary?.otherChapterName && (
              <p style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>{summary.otherChapterName}</p>
            )}
          </div>
        </div>
        {muted !== null && (
          <button
            type="button" onClick={() => { void handleMuteToggle(); }} disabled={muting}
            style={muteHeaderButtonStyle}
          >
            {muted ? "🔕 Muted" : "🔔 Mute"}
          </button>
        )}
      </div>

      {status !== "live" && (
        <div style={bannerStyle(status)}>
          {status === "offline"
            ? "You're offline. New messages won't appear until you're back online."
            : "Reconnecting — you may not see new messages right away."}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
        {hasMore && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <button type="button" onClick={() => { void loadEarlier(); }} disabled={loadingMore} style={loadMoreStyle}>
              {loadingMore ? "Loading…" : "Load earlier messages"}
            </button>
            {moreError && <p style={errorTextStyle}>{moreError}</p>}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title="No messages yet"
            body={`Say something to ${summary?.otherGiftName ?? "start"} the conversation.`}
          />
        ) : (
          rows.map(m => (
            <div key={m.messageId} style={rowStyle}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {m.senderGiftName}
                <span style={{ fontWeight: 400, color: "var(--mute)" }}> · {shortTime(m.sentDateUtc)}</span>
              </div>
              <div style={bodyStyle}>{m.body}</div>
            </div>
          ))
        )}
        <div ref={listEndRef} />
      </div>

      <form onSubmit={e => { void handleSend(e); }} style={composerRowStyle}>
        <textarea
          aria-label="Write a message"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          disabled={status === "offline" || sending}
          onChange={e => setBody(e.target.value)}
          placeholder={status === "offline" ? "You're offline. This message will not send." : "Write a message…"}
          rows={2}
          style={composerFieldStyle}
        />
        <button
          type="submit"
          disabled={status === "offline" || sending || !body.trim()}
          style={{ ...sendButtonStyle, opacity: (status === "offline" || sending || !body.trim()) ? 0.6 : 1 }}
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
      {sendError && <p style={{ ...errorTextStyle, padding: "0 12px 10px" }}>{sendError}</p>}
    </div>
  );
}

function bannerStyle(s: "connecting" | "reconnecting" | "offline" | "live"): CSSProperties {
  const base: CSSProperties = { padding: "8px 16px", fontSize: 12, textAlign: "center" };
  if (s === "offline") return { ...base, background: "#F7E7E4", color: "var(--out)" };
  return { ...base, background: "#FBF4E4", color: "var(--warn)" };
}

const headerStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10,
  padding: "10px 16px 10px", borderBottom: "1px solid var(--line)",
};

const backArrowStyle: CSSProperties = {
  flex: "none", width: "var(--tap)", height: "var(--tap)", display: "flex",
  alignItems: "center", justifyContent: "center", fontSize: 24,
  color: "var(--ink)", textDecoration: "none",
};

const muteHeaderButtonStyle: CSSProperties = {
  flex: "none", minHeight: 32, padding: "0 10px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--slate)", fontSize: 12,
};

const backLinkStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: "var(--tap)", padding: "0 18px",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em",
  textTransform: "uppercase", textDecoration: "none",
};

const rowStyle: CSSProperties = {
  padding: "10px 4px", borderBottom: "1px solid var(--line)",
};

const bodyStyle: CSSProperties = {
  fontSize: 13.5, lineHeight: 1.5, marginTop: 3, whiteSpace: "pre-wrap", wordBreak: "break-word",
};

const composerRowStyle: CSSProperties = {
  display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--line)",
  background: "var(--paper)", alignItems: "flex-end",
};

const composerFieldStyle: CSSProperties = {
  flex: 1, padding: 10, borderRadius: 8, fontSize: 14, resize: "none",
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
  fontFamily: "inherit",
};

const sendButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};

const loadMoreStyle: CSSProperties = {
  minHeight: 36, padding: "0 16px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase",
};

const errorTextStyle: CSSProperties = { fontSize: 12, color: "var(--out)", marginTop: 6, lineHeight: 1.5 };
