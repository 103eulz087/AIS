import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canModerateChat } from "@/shared/roles";
import { useChatConnection } from "@/shared/chat-connection";
import { isSameChapter, type ChatRoom as ChatRoomState, type DirectoryRow } from "@/shared/types";
import type {
  ChatMessage, ChatMessageFlagged, ChatMessageRemoved, ChatModerationQueue,
} from "@/shared/types";

const PAGE_SIZE = 50;
const MAX_BODY_LENGTH = 2000;
const MENTION_MATCH_LIMIT = 8;

/** One name picked from the @-mention picker, kept alongside the draft text. */
interface SelectedMention {
  memberId: number;
  giftName: string;
}

/**
 * The chapter's public chat room, at /chat.
 *
 * Endpoints:
 *  - GET  /api/chapters/{chapterId}/chat/room                        — on mount; lazily
 *    creates the room on the chapter's first-ever open. The response isn't rendered
 *    directly, it's just the "the room exists now" step the backend requires first.
 *  - GET  /api/chapters/{chapterId}/chat/messages?beforeMessageId=&take=  — newest
 *    first from the server; this screen reverses it to oldest-first for display and
 *    reverses each older page the same way before PREPENDING it.
 *  - POST /api/chapters/{chapterId}/chat/messages                    — {body}. The
 *    posted message is added to the list from THIS call's response, or from the
 *    "MessagePosted" broadcast (whichever arrives first) — never optimistically before
 *    the POST succeeds.
 *  - POST /api/chapters/{chapterId}/chat/messages/{id}/flag          — {reason?}. No
 *    reason prompt on this screen (optional field); a small disable-after-click is
 *    the only "optimistic" behaviour, safe because flagging is idempotent.
 *  - POST /api/chapters/{chapterId}/chat/messages/{id}/remove        — {reason}.
 *    Officers/admins only; prompts for a short reason first (never fired bare).
 *  - POST /api/chapters/{chapterId}/chat/read                        — {lastReadMessageId}.
 *    Fire-and-forget, silently: this only advances the caller's own read cursor, a
 *    low-stakes preference write with no visible effect either way, so a failure here
 *    is never surfaced (same posture as handleFlag's own catch below). Called once the
 *    newest loaded message changes — after the initial history load, and again each
 *    time a "MessagePosted" broadcast lands — never on every scroll and never twice
 *    for the same message (see the lastMarkedMessageId ref).
 *  - SignalR /hubs/chat — "MessagePosted"/"MessageRemoved" (every member),
 *    "MessageFlagged" (officers/admins only — see ChatHub.cs).
 *
 * States: loading (skeleton) / error (one sentence + Retry) / empty ("no messages
 * yet") / loaded (message list + composer). The connection banner and the
 * offline-disabled composer are sub-states of "loaded", not separate top-level ones —
 * a member can always still read what already loaded even while reconnecting.
 *
 * Per docs/AIS-Project-Documentation.md §4.8, the header discloses plainly that
 * officers can read and remove messages here. Nothing here promises purging or
 * automatic deletion after any period — retention is a later module, not this one.
 */
export function ChatRoom({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canModerateChat(roles);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // @-mention picker state. mentionQuery is null when the picker is closed; otherwise
  // it's whatever text follows the "@" the member is currently typing (may be empty,
  // right after typing "@" itself). mentionStart is that "@"'s own index in `body`,
  // used to splice the picked name in and to re-derive the query on every keystroke.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  // Only names actually picked from the picker land here — a member hand-typing
  // "@SomeName" without using it is inert, cosmetic text only (the confirmed backend
  // design: the server only trusts picker-resolved, verified mentions).
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [flaggingIds, setFlaggingIds] = useState<Set<number>>(new Set());
  const [removeTargetId, setRemoveTargetId] = useState<number | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const { status, connection } = useChatConnection(chapterId);
  const listEndRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitially = useRef(false);
  const lastMarkedMessageId = useRef<number | null>(null);

  // Officers get a small, cheap badge of how many messages currently have an open
  // (unresolved) flag — same "fetch take=1 for the total" trick AppShell's own
  // applications badge uses. Never rendered for a plain member.
  const flaggedCount = useQuery({
    queryKey: ["chat-moderation-queue-count", chapterId],
    queryFn: () => api.get<ChatModerationQueue>(
      `/api/chapters/${chapterId}/chat/moderation-queue?skip=0&take=1&includeResolved=false`),
    enabled: isOfficer,
    staleTime: 30_000,
  });

  // The chapter roster, reused for two things: filtering the @-mention picker's
  // candidate list, and — separately — re-deriving which "@Word" tokens in an
  // ALREADY-SENT message are real, resolved mentions worth highlighting (cosmetic
  // only; never stored, see MessageRow's own rendering below). Reuses the existing
  // member-search endpoint (GET /api/members) rather than a new one — no backend
  // change was made for this screen.
  const roster = useQuery({
    queryKey: ["chat-roster", chapterId],
    queryFn: () => api.get<Paged<DirectoryRow>>(`/api/members?chapterId=${chapterId}&take=200`),
    staleTime: 60_000,
  });
  const rosterMembers = (roster.data?.items ?? []).filter(isSameChapter);
  const knownGiftNames = new Set(rosterMembers.map(m => m.giftName.toUpperCase()));
  const mentionMatches = mentionQuery === null ? [] : rosterMembers
    .filter(m => m.memberId !== claims?.memberId)
    .filter(m => m.giftName.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, MENTION_MATCH_LIMIT);

  // Seeded from GET .../chat/room's own isMuted field once loadInitial resolves below —
  // false only as the pre-load default, never a claim about the saved state.
  const [muted, setMuted] = useState(false);
  const [muting, setMuting] = useState(false);

  async function handleMuteToggle() {
    const next = !muted;
    setMuting(true);
    setMuted(next);
    try {
      await api.post(`/api/chapters/${chapterId}/chat/mute`, { isMuted: next });
    } catch {
      setMuted(!next); // Revert — this toggle must never claim a mute that didn't take.
    } finally {
      setMuting(false);
    }
  }

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
      const room = await api.get<ChatRoomState>(`/api/chapters/${chapterId}/chat/room`);
      const rows = await api.get<ChatMessage[]>(
        `/api/chapters/${chapterId}/chat/messages?take=${PAGE_SIZE}`);
      if (cancelled()) return;
      setMuted(room.isMuted);
      setMessages([...rows].reverse());
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      if (cancelled()) return;
      setMessages(null);
      setLoadError(err instanceof ApiError ? err.message : "Check your connection and try again.");
    }
  }, [chapterId]);

  // A cancellation flag, not an AbortController: a member flipping between screens
  // faster than the initial history call returns should never crash on a
  // set-state-after-unmount, but there is nothing to actually abort server-side here.
  useEffect(() => {
    let isCancelled = false;
    void loadInitial(() => isCancelled);
    return () => { isCancelled = true; };
  }, [loadInitial, reloadToken]);

  // Newest message scrolls into view once, right after the first page loads — not on
  // every re-render, and not while someone is reading up in "Load earlier" territory.
  useEffect(() => {
    if (messages && messages.length > 0 && !hasScrolledInitially.current) {
      hasScrolledInitially.current = true;
      // jsdom (this app's test environment) has no scrollIntoView implementation at
      // all — guard its existence rather than only patching the test environment,
      // since a stripped-down WebView on a cheap Android phone is a real-world
      // possibility this screen should degrade gracefully against too.
      listEndRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [messages]);

  // Advances the caller's own read cursor whenever the newest loaded message changes
  // — once right after the initial history load, and again each time a new message
  // is merged in via "MessagePosted". Never fires twice for the same newest id (the
  // ref guards both a re-render with the same messages and an older page being
  // prepended by "Load earlier messages", which never changes the newest entry).
  // Fire-and-forget and silent on failure — see this screen's own doc comment.
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (!newest) return;
    if (lastMarkedMessageId.current !== null && newest.messageId <= lastMarkedMessageId.current) return;
    lastMarkedMessageId.current = newest.messageId;
    api.post(`/api/chapters/${chapterId}/chat/read`, { lastReadMessageId: newest.messageId }).catch(() => {
      // Best-effort only, same reasoning as handleFlag's own silent catch below — a
      // missed read-cursor update is invisible to the member and not worth retrying.
    });
  }, [messages, chapterId]);

  useEffect(() => {
    if (!connection) return;

    const onPosted = (dto: ChatMessage) => merge(dto);
    const onRemoved = (dto: ChatMessageRemoved) => {
      setMessages(prev => prev?.map(m => m.messageId === dto.messageId
        ? { ...m, isDeleted: true, deletedDateUtc: dto.deletedDateUtc, body: m.canSeeRemovedBody ? m.body : null }
        : m) ?? prev);
    };
    const onFlagged = (dto: ChatMessageFlagged) => {
      setMessages(prev => prev?.map(m => m.messageId === dto.messageId
        ? { ...m, flagCount: dto.flagCount } : m) ?? prev);
      void flaggedCount.refetch();
    };

    connection.on("MessagePosted", onPosted);
    connection.on("MessageRemoved", onRemoved);
    connection.on("MessageFlagged", onFlagged);

    return () => {
      connection.off("MessagePosted", onPosted);
      connection.off("MessageRemoved", onRemoved);
      connection.off("MessageFlagged", onFlagged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, merge]);

  async function loadEarlier() {
    const oldest = messages?.[0];
    if (!oldest) return;
    setMoreError(null);
    setLoadingMore(true);
    try {
      const rows = await api.get<ChatMessage[]>(
        `/api/chapters/${chapterId}/chat/messages?beforeMessageId=${oldest.messageId}&take=${PAGE_SIZE}`);
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
      const posted = await api.post<ChatMessage>(`/api/chapters/${chapterId}/chat/messages`, {
        body: trimmed,
        // Only picker-selected ids — see PostMessageRequest.Mentions's own doc comment:
        // the server re-verifies every one of these (same chapter, active, actually
        // referenced in the body, not the sender himself) before recording anything,
        // so this is a hint, never an authorization.
        mentions: selectedMentions.map(m => m.memberId),
      });
      merge(posted);
      setBody("");
      setSelectedMentions([]);
      setMentionQuery(null);
      setMentionStart(null);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Could not send that message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Tracks whether the member is currently mid-way through typing an @-mention: an
   * "@" with no whitespace between it and the cursor. Reset to closed the moment a
   * space (or anything else that isn't a mention query) appears — an "@" earlier in
   * already-finished text must never reopen the picker.
   */
  function handleBodyChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);

    const cursor = e.target.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const at = uptoCursor.lastIndexOf("@");
    if (at === -1) { setMentionQuery(null); setMentionStart(null); return; }

    const between = uptoCursor.slice(at + 1);
    if (/\s/.test(between)) { setMentionQuery(null); setMentionStart(null); return; }

    setMentionQuery(between);
    setMentionStart(at);
  }

  /** Inserts "@GiftName " as literal text and records the id alongside the draft. */
  function handleSelectMention(member: { memberId: number; giftName: string }) {
    if (mentionStart === null) return;
    const cursor = textareaRef.current?.selectionStart ?? body.length;
    const before = body.slice(0, mentionStart);
    const after = body.slice(cursor);
    const insertion = `@${member.giftName} `;
    const nextValue = `${before}${insertion}${after}`;

    setBody(nextValue);
    setSelectedMentions(prev => prev.some(m => m.memberId === member.memberId)
      ? prev
      : [...prev, { memberId: member.memberId, giftName: member.giftName }]);
    setMentionQuery(null);
    setMentionStart(null);

    // Restores focus and places the cursor right after the inserted name — the
    // browser would otherwise leave it wherever it happened to be on this re-render.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + insertion.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleFlag(messageId: number) {
    setFlaggingIds(prev => new Set(prev).add(messageId));
    try {
      const result = await api.post<ChatMessageFlagged>(
        `/api/chapters/${chapterId}/chat/messages/${messageId}/flag`, {});
      setMessages(prev => prev?.map(m => m.messageId === messageId
        ? { ...m, hasFlagged: true, flagCount: result.flagCount } : m) ?? prev);
    } catch {
      // Flagging failing quietly is acceptable here — worst case the member tries
      // again; the button re-enables itself since hasFlagged never got set.
      setFlaggingIds(prev => { const next = new Set(prev); next.delete(messageId); return next; });
    }
  }

  async function handleRemove(e: FormEvent) {
    e.preventDefault();
    if (removeTargetId === null) return;
    setRemoveError(null);
    setRemoving(true);
    try {
      const result = await api.post<ChatMessageRemoved>(
        `/api/chapters/${chapterId}/chat/messages/${removeTargetId}/remove`, { reason: removeReason.trim() });
      setMessages(prev => prev?.map(m => m.messageId === removeTargetId
        ? { ...m, isDeleted: true, deletedDateUtc: result.deletedDateUtc, body: m.canSeeRemovedBody ? m.body : null }
        : m) ?? prev);
      setRemoveTargetId(null);
      setRemoveReason("");
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Could not remove that message. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  if (messages === null && !loadError) return <ScreenSkeleton rows={6} />;
  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setReloadToken(t => t + 1)} />;
  }

  const rows = messages ?? [];
  const openFlagged = flaggedCount.data?.total ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "70vh" }}>
      <div style={headerStyle}>
        <div>
          <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 19, letterSpacing: ".03em" }}>Chapter chat</h1>
          <p style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 3, lineHeight: 1.5 }}>
            Officers can read and remove messages here.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <button
            type="button" onClick={() => { void handleMuteToggle(); }} disabled={muting}
            style={muteHeaderButtonStyle}
          >
            {muted ? "🔕 Muted" : "🔔 Mute"}
          </button>
          {isOfficer && (
            <Link to="/chat/moderation" style={moderationLinkStyle}>
              Moderation queue{openFlagged > 0 ? ` (${openFlagged})` : ""}
            </Link>
          )}
        </div>
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
            title="Walang mensahe pa"
            body="Simulan ang usapan — kausapin ang buong chapter dito. No messages yet. Say something to start the conversation."
          />
        ) : (
          rows.map(m => (
            <MessageRow
              key={m.messageId}
              message={m}
              isOfficer={isOfficer}
              knownGiftNames={knownGiftNames}
              flagPending={flaggingIds.has(m.messageId)}
              onFlag={() => { void handleFlag(m.messageId); }}
              onRemoveClick={() => { setRemoveTargetId(m.messageId); setRemoveReason(""); setRemoveError(null); }}
              removeFormOpen={removeTargetId === m.messageId}
              removeReason={removeReason}
              onRemoveReasonChange={setRemoveReason}
              onRemoveCancel={() => { setRemoveTargetId(null); setRemoveReason(""); setRemoveError(null); }}
              onRemoveSubmit={handleRemove}
              removing={removing}
              removeError={removeTargetId === m.messageId ? removeError : null}
            />
          ))
        )}
        <div ref={listEndRef} />
      </div>

      {mentionQuery !== null && (
        <div role="listbox" aria-label="Mention a chapter member" style={mentionPickerStyle}>
          {mentionMatches.length === 0 ? (
            <div style={mentionEmptyStyle}>
              {mentionQuery ? `No one matches "${mentionQuery}"` : "Type a name to mention someone"}
            </div>
          ) : (
            mentionMatches.map(m => (
              <button
                key={m.memberId} type="button" role="option"
                onClick={() => handleSelectMention(m)}
                style={mentionOptionStyle}
              >
                {m.giftName}
              </button>
            ))
          )}
        </div>
      )}

      <form onSubmit={e => { void handleSend(e); }} style={composerRowStyle}>
        <textarea
          ref={textareaRef}
          aria-label="Write a message"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          disabled={status === "offline" || sending}
          onChange={handleBodyChange}
          placeholder={status === "offline" ? "You're offline. This message will not send." : "Write a message… (@ to mention someone)"}
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

/**
 * Re-derives which "@Word" tokens in an already-sent body are real, resolved
 * mentions — never stored separately, purely cosmetic (a subtle highlight pill for
 * readability). A hand-typed "@SomeName" that doesn't match anyone on the current
 * chapter roster renders as plain text, same as it would have before this feature.
 */
function renderBodyWithMentions(body: string, knownGiftNames: Set<string>): ReactNode {
  const pattern = /@([A-Za-z0-9_]+)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const [full, name] = match;
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    if (name && knownGiftNames.has(name.toUpperCase())) {
      parts.push(<span key={key++} style={mentionPillStyle}>{full}</span>);
    } else {
      parts.push(full);
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
}

function MessageRow({
  message: m, isOfficer, knownGiftNames, flagPending, onFlag, onRemoveClick, removeFormOpen,
  removeReason, onRemoveReasonChange, onRemoveCancel, onRemoveSubmit, removing, removeError,
}: {
  message: ChatMessage; isOfficer: boolean; knownGiftNames: Set<string>;
  flagPending: boolean; onFlag: () => void;
  onRemoveClick: () => void; removeFormOpen: boolean; removeReason: string;
  onRemoveReasonChange: (v: string) => void; onRemoveCancel: () => void;
  onRemoveSubmit: (e: FormEvent) => void; removing: boolean; removeError: string | null;
}) {
  const alreadyFlagged = m.hasFlagged || flagPending;

  return (
    <div style={rowStyle}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>
        {m.senderGiftName}
        <span style={{ fontWeight: 400, color: "var(--mute)" }}> · {shortTime(m.sentDateUtc)}</span>
      </div>

      {m.isDeleted ? (
        <div style={tombstoneStyle}>
          Message removed by an officer · {shortDate(m.deletedDateUtc)}
          {/* An officer allowed to see the removed body still gets it here, in plain
              muted text — never restyled to look like a normal, live message. */}
          {m.canSeeRemovedBody && m.body && (
            <div style={officerVisibleBodyStyle}>{m.body}</div>
          )}
        </div>
      ) : (
        <div style={bodyStyle}>{m.body && renderBodyWithMentions(m.body, knownGiftNames)}</div>
      )}

      {!m.isDeleted && (
        <div style={actionsRowStyle}>
          <button type="button" onClick={onFlag} disabled={alreadyFlagged} style={ghostSmallButtonStyle}>
            {alreadyFlagged ? "Flagged" : "Flag"}
          </button>
          {isOfficer && (
            <button type="button" onClick={onRemoveClick} style={ghostSmallButtonStyle}>Remove</button>
          )}
          {m.flagCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--warn)" }}>
              {m.flagCount} flag{m.flagCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {removeFormOpen && (
        <form onSubmit={onRemoveSubmit} style={{ marginTop: 8 }}>
          <label htmlFor={`remove-reason-${m.messageId}`} style={labelStyle}>Reason for removing</label>
          <textarea
            id={`remove-reason-${m.messageId}`} value={removeReason}
            onChange={e => onRemoveReasonChange(e.target.value)} rows={2}
            style={{ ...composerFieldStyle, width: "100%" }}
          />
          {removeError && <p role="alert" style={errorTextStyle}>{removeError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onRemoveCancel} style={ghostSmallButtonStyle}>Cancel</button>
            <button
              type="submit" disabled={removing || removeReason.trim().length === 0}
              style={{ ...removeButtonStyle, opacity: removing ? 0.7 : 1 }}
            >
              {removing ? "Removing…" : "Remove message"}
            </button>
          </div>
        </form>
      )}
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
  padding: "14px 16px 10px", borderBottom: "1px solid var(--line)",
};

const moderationLinkStyle: CSSProperties = {
  flex: "none", fontSize: 11.5, color: "var(--info)", textDecoration: "none",
  minHeight: 32, display: "flex", alignItems: "center",
};

const muteHeaderButtonStyle: CSSProperties = {
  flex: "none", minHeight: 32, padding: "0 10px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--slate)", fontSize: 12,
};

const rowStyle: CSSProperties = {
  padding: "10px 4px", borderBottom: "1px solid var(--line)",
};

const bodyStyle: CSSProperties = {
  fontSize: 13.5, lineHeight: 1.5, marginTop: 3, whiteSpace: "pre-wrap", wordBreak: "break-word",
};

const tombstoneStyle: CSSProperties = {
  fontSize: 12.5, fontStyle: "italic", color: "var(--mute)", marginTop: 3, lineHeight: 1.5,
};

const officerVisibleBodyStyle: CSSProperties = {
  fontSize: 12.5, color: "var(--slate)", marginTop: 4, fontStyle: "normal",
  whiteSpace: "pre-wrap", wordBreak: "break-word",
};

const actionsRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, marginTop: 6,
};

const ghostSmallButtonStyle: CSSProperties = {
  minHeight: 30, padding: "0 10px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)", fontSize: 11.5,
};

const removeButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8,
  background: "var(--out)", color: "var(--paper)", fontSize: 13,
};

const mentionPickerStyle: CSSProperties = {
  maxHeight: 160, overflowY: "auto", borderTop: "1px solid var(--line)",
  background: "var(--paper)",
};

const mentionOptionStyle: CSSProperties = {
  display: "block", width: "100%", textAlign: "left", minHeight: "var(--tap)",
  padding: "0 16px", fontSize: 13.5, borderBottom: "1px solid var(--line)",
};

const mentionEmptyStyle: CSSProperties = {
  padding: "10px 16px", fontSize: 12.5, color: "var(--mute)",
};

const mentionPillStyle: CSSProperties = {
  background: "var(--brass-soft)", color: "var(--brass-dk)", borderRadius: 4,
  padding: "0 4px", fontWeight: 600,
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

const labelStyle: CSSProperties = { display: "block", fontSize: 12, color: "var(--slate)", marginBottom: 4 };

const errorTextStyle: CSSProperties = { fontSize: 12, color: "var(--out)", marginTop: 6, lineHeight: 1.5 };
