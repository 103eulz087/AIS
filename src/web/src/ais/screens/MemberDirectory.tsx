import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { isSameChapter, MEMBER_STATUSES, type ConversationStarted, type DirectoryRow } from "@/shared/types";
import { useState, type CSSProperties } from "react";

const BLOOD = ["All", "O+", "O−", "A+", "B+", "AB+"];

export function MemberDirectory() {
  const [blood, setBlood] = useState("All");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // "tap to call or message" (docs §4.2). Message is same-chapter only this slice —
  // see the row rendering below, gated on isSameChapter(row) alongside the existing
  // full-shape fields it already restricts to same-chapter brothers.
  const [startingId, setStartingId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  async function handleMessage(memberId: number) {
    setStartError(null);
    setStartingId(memberId);
    try {
      const started = await api.post<ConversationStarted>("/api/conversations", { withMemberId: memberId });
      // Carried as router state so Conversation.tsx never needs a second round trip
      // just to render its own header — see that screen's own header comment.
      navigate(`/conversations/${started.roomId}`, {
        state: {
          summary: {
            roomId: started.roomId, otherMemberId: started.otherMemberId,
            otherGiftName: started.otherGiftName, otherChapterName: started.otherChapterName,
            lastMessageId: null, lastMessagePreview: null, lastMessageDate: null,
            unreadCount: 0, isMuted: started.isMuted,
          },
        },
      });
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : "Could not start that conversation. Please try again.");
    } finally {
      setStartingId(null);
    }
  }

  // Arrives as /members?statusId={id} from the Chapter Dashboard's membership tiles
  // (CLAUDE.md: "a figure the user cannot open is not transparency" — every tile there
  // drills through to real rows here). Any status other than Approved/Active needs
  // includeInactive alongside StatusId or usp_Member_Search's own default gate hides it
  // (see MemberSearchRequest's doc comment in MemberDtos.cs) — passing it whenever a
  // statusId filter is active is harmless for Approved/Active too, since StatusId still
  // restricts the result to that exact status either way.
  const statusIdParam = searchParams.get("statusId");
  const statusId = statusIdParam ? Number(statusIdParam) : null;
  const statusLabel = MEMBER_STATUSES.find(s => s.id === statusId)?.name ?? null;

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["members", blood, statusId],
    queryFn: () => api.get<Paged<DirectoryRow>>(
      `/api/members?take=50${blood !== "All" ? `&bloodType=${encodeURIComponent(blood)}` : ""}`
      + (statusId ? `&statusId=${statusId}&includeInactive=true` : "")),
  });

  function clearStatusFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("statusId");
    setSearchParams(next);
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (!data?.items.length) {
    return (
      <EmptyState
        title="No brothers match that filter"
        body={statusLabel
          ? `No brother in this chapter is currently marked ${statusLabel}.`
          : blood === "All"
            ? "Once members are approved they appear here, searchable by blood type, skill and profession."
            : `No brother in this chapter is recorded as ${blood}. Try searching other chapters.`}
        action={<CorrectiveActionsLink />}
      />
    );
  }

  return (
    <div>
      <div style={{ padding: "10px 16px 0" }}>
        <CorrectiveActionsLink />
      </div>

      {startError && <p role="alert" style={startErrorStyle}>{startError}</p>}

      {statusLabel && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          margin: "10px 16px 0", padding: "8px 12px", borderRadius: 8, fontSize: 12.5,
          background: "var(--bond)", color: "var(--slate)",
        }}>
          <span>Showing only: {statusLabel}</span>
          <button type="button" onClick={clearStatusFilter} style={{
            fontSize: 12, color: "var(--info)", textDecoration: "underline", minHeight: 32,
          }}>Clear</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px" }}>
        {BLOOD.map(b => (
          <button key={b} onClick={() => setBlood(b)} style={{
            flex: "none", padding: "6px 12px", borderRadius: 16, fontSize: 12,
            border: "1px solid var(--line)", minHeight: 34,
            background: blood === b ? "var(--deep)" : "var(--paper)",
            color: blood === b ? "var(--brass-soft)" : "var(--slate)",
          }}>{b}</button>
        ))}
      </div>

      {data.items.map(row => (
        <div key={row.memberId} style={{
          display: "flex", gap: 12, alignItems: "center", padding: 12,
          background: "var(--paper)", borderBottom: "1px solid var(--line)",
          minHeight: "var(--tap)",
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 8, background: "var(--deep)",
            color: "var(--brass-soft)", display: "grid", placeItems: "center",
            fontFamily: "var(--f-disp)", fontSize: 17,
          }}>{row.giftName.slice(0, 2)}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{row.giftName}</div>
            {/* Cross-chapter rows carry chapter and status only — render exactly what arrived. */}
            <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
              {isSameChapter(row)
                ? [row.fullName, row.profession].filter(Boolean).join(" · ")
                : row.chapterName}
            </div>
          </div>

          {isSameChapter(row) && row.bloodType && (
            <span className="num" style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 4,
              color: "var(--out)", border: "1px solid #E4C4C0", background: "#FBF0EF",
            }}>{row.bloodType}</span>
          )}

          {/* Same-chapter only this slice — a cross-chapter row never gets a Message
              action (nor the phone/contact details a "call" action would need). */}
          {isSameChapter(row) && (
            <button
              type="button"
              onClick={() => { void handleMessage(row.memberId); }}
              disabled={startingId === row.memberId}
              style={messageButtonStyle}
            >
              {startingId === row.memberId ? "…" : "Message"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Entry point into /corrective-actions from the Members tab — reading the list is open
 * to every chapter member (only filing/status-updates are ChapterAdmin-gated, inside
 * CaseList/CaseDetail themselves), so this link is never role-gated here either.
 */
function CorrectiveActionsLink() {
  return (
    <Link
      to="/corrective-actions"
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
        border: "1px solid var(--line)", background: "var(--paper)",
        color: "var(--ink)", fontSize: 13.5, textDecoration: "none",
      }}
    >
      <span>Corrective actions</span>
      <span style={{ color: "var(--mute)" }}>›</span>
    </Link>
  );
}

const messageButtonStyle: CSSProperties = {
  flex: "none", minHeight: 34, padding: "0 12px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 12.5,
};

const startErrorStyle: CSSProperties = {
  margin: "10px 16px 0", fontSize: 12.5, color: "var(--out)", lineHeight: 1.5,
};
