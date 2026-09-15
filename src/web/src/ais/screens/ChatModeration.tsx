import { useState, type CSSProperties, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canModerateChat } from "@/shared/roles";
import type {
  ChatFlaggedMessage, ChatMessageRemoved, ChatModerationQueue,
} from "@/shared/types";

const TAKE = 25;

/**
 * The chapter's chat moderation queue, at /chat/moderation. Reachable only from a
 * small link inside ChatRoom.tsx for an officer — never from the bottom nav or Home
 * directly (AppShell.tsx is already at its documented tab cap).
 *
 * GET /api/chapters/{chapterId}/chat/moderation-queue?skip=&take=&includeResolved=false
 * — one row per flagged message (result set 1) plus every (message, flagger) pair
 * (result set 2), joined client-side by messageId. Officer/admin only
 * (AuthorizationPolicies.ChapterChatModerate); a plain member sees this project's
 * standard plain "you don't have access" state, same pattern as ApplicationQueue's own
 * canApproveApplications gate.
 *
 * Actions: POST .../messages/{id}/remove (reason required, prompts first) and
 * POST .../messages/{id}/resolve-flags (note optional, no prompt — dismissing a flag
 * as unfounded doesn't carry the same weight as removing someone's message). Neither
 * event is broadcast to this screen over SignalR — a refetch after each action is
 * what this screen already does for itself.
 */
export function ChatModeration({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canModerate = canModerateChat(roles);

  const [skip, setSkip] = useState(0);
  const [removeTargetId, setRemoveTargetId] = useState<number | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["chat-moderation-queue", chapterId, skip],
    queryFn: () => api.get<ChatModerationQueue>(
      `/api/chapters/${chapterId}/chat/moderation-queue?skip=${skip}&take=${TAKE}&includeResolved=false`),
    enabled: canModerate,
  });

  if (!canModerate) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only chapter officers can review flagged chat messages."
      />
    );
  }

  if (isLoading) return <ScreenSkeleton rows={5} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const messages = data?.messages ?? [];

  async function handleRemove(e: FormEvent) {
    e.preventDefault();
    if (removeTargetId === null) return;
    setRemoveError(null);
    setRemoving(true);
    try {
      await api.post<ChatMessageRemoved>(
        `/api/chapters/${chapterId}/chat/messages/${removeTargetId}/remove`, { reason: removeReason.trim() });
      setRemoveTargetId(null);
      setRemoveReason("");
      await refetch();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Could not remove that message. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleDismiss(messageId: number) {
    setActionError(null);
    setDismissingId(messageId);
    try {
      await api.post(`/api/chapters/${chapterId}/chat/messages/${messageId}/resolve-flags`, {});
      await refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not dismiss those flags. Please try again.");
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: "16px 16px 0" }}>
        <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".03em" }}>
          Flagged chat messages
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 4, lineHeight: 1.5 }}>
          Messages a member has flagged for a chapter officer to review.
        </p>
      </div>

      {actionError && <p style={{ ...errorTextStyle, padding: "10px 16px 0" }}>{actionError}</p>}

      {messages.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          body="No chat messages are currently flagged for this chapter."
        />
      ) : (
        <div style={{ padding: "12px 16px 0" }}>
          {messages.map(m => (
            <FlaggedRow
              key={m.messageId}
              message={m}
              flags={(data?.flags ?? []).filter(f => f.messageId === m.messageId)}
              onRemoveClick={() => { setRemoveTargetId(m.messageId); setRemoveReason(""); setRemoveError(null); }}
              removeFormOpen={removeTargetId === m.messageId}
              removeReason={removeReason}
              onRemoveReasonChange={setRemoveReason}
              onRemoveCancel={() => { setRemoveTargetId(null); setRemoveReason(""); setRemoveError(null); }}
              onRemoveSubmit={handleRemove}
              removing={removing}
              removeError={removeTargetId === m.messageId ? removeError : null}
              onDismiss={() => { void handleDismiss(m.messageId); }}
              dismissing={dismissingId === m.messageId}
            />
          ))}

          {data && data.total > skip + messages.length && (
            <div style={{ padding: "16px 0", textAlign: "center" }}>
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

function FlaggedRow({
  message: m, flags, onRemoveClick, removeFormOpen, removeReason, onRemoveReasonChange,
  onRemoveCancel, onRemoveSubmit, removing, removeError, onDismiss, dismissing,
}: {
  message: ChatFlaggedMessage; flags: ChatModerationQueue["flags"];
  onRemoveClick: () => void; removeFormOpen: boolean; removeReason: string;
  onRemoveReasonChange: (v: string) => void; onRemoveCancel: () => void;
  onRemoveSubmit: (e: FormEvent) => void; removing: boolean; removeError: string | null;
  onDismiss: () => void; dismissing: boolean;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.senderGiftName}</div>
        <span style={flagCountPillStyle}>{m.flagCount} flag{m.flagCount === 1 ? "" : "s"}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>{shortDate(m.sentDateUtc)} · {shortTime(m.sentDateUtc)}</div>

      {m.isDeleted ? (
        <p style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--mute)", marginTop: 8 }}>
          This message has already been removed.
        </p>
      ) : (
        <p style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {m.body}
        </p>
      )}

      <div style={{ marginTop: 10 }}>
        <div style={sectionLabelStyle}>Flagged by</div>
        {flags.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--mute)" }}>No flag detail on file.</p>
        ) : (
          flags.map(f => (
            <div key={`${f.messageId}-${f.memberId}`} style={flagRowStyle}>
              <span style={{ fontWeight: 600 }}>{f.flaggerGiftName}</span>
              {f.reason ? <span> — {f.reason}</span> : <span style={{ color: "var(--mute)" }}> — no reason given</span>}
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {!m.isDeleted && (
          <button type="button" onClick={onRemoveClick} style={removeButtonStyle}>Remove</button>
        )}
        <button type="button" onClick={onDismiss} disabled={dismissing} style={ghostSmallButtonStyle}>
          {dismissing ? "Dismissing…" : "Dismiss flags"}
        </button>
      </div>

      {removeFormOpen && (
        <form onSubmit={onRemoveSubmit} style={{ marginTop: 10 }}>
          <label htmlFor={`mod-remove-reason-${m.messageId}`} style={labelStyle}>Reason for removing</label>
          <textarea
            id={`mod-remove-reason-${m.messageId}`} value={removeReason}
            onChange={e => onRemoveReasonChange(e.target.value)} rows={2}
            style={fieldStyle}
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

const cardStyle: CSSProperties = {
  padding: 12, borderRadius: "var(--r)", border: "1px solid var(--line)",
  background: "var(--paper)", marginBottom: 10,
};

const flagCountPillStyle: CSSProperties = {
  flex: "none", fontSize: 10.5, padding: "2px 8px", borderRadius: 10,
  background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8", height: "fit-content",
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--mute)", marginBottom: 4,
};

const flagRowStyle: CSSProperties = { fontSize: 12.5, lineHeight: 1.6, color: "var(--slate)" };

const ghostSmallButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)", fontSize: 13,
};

const removeButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8,
  background: "var(--out)", color: "var(--paper)", fontSize: 13,
};

const fieldStyle: CSSProperties = {
  width: "100%", padding: 10, borderRadius: 8, fontSize: 14, resize: "none",
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontFamily: "inherit",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 12, color: "var(--slate)", marginBottom: 4 };

const errorTextStyle: CSSProperties = { fontSize: 12, color: "var(--out)", marginTop: 6, lineHeight: 1.5 };

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
