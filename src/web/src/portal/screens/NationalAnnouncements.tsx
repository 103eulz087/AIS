import { useState, type CSSProperties, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canPostNationalAnnouncements } from "@/shared/roles";
import { shortDate } from "@/shared/format";
import type { Announcement } from "@/shared/types";

interface AnnouncementCreated { announcementId: number }

/**
 * National Council's own announcement board — post something once here, and it
 * shows up in every chapter AIS user's own dashboard feed (Home.tsx's Notices
 * preview, AnnouncementList/AnnouncementDetail), badged "National", with a push
 * notification to every active member unless he's turned that alert off
 * (Profile > Notification settings). No UrgentType/BloodType fields here — those
 * are a chapter-level blood/assistance request concept (client decision
 * 2026-09-27, see usp_Announcement_CreateNational.sql's own header comment); "This
 * is urgent" alone still gets the same red styling everywhere the merged feed
 * already renders it.
 *
 * canPostNationalAnnouncements gates the whole screen; the server re-derives the
 * real "specifically the National Council's own Admin" authorization independently
 * inside usp_Announcement_CreateNational/_WithdrawNational, same "coarse client
 * check, real server check" posture as every other Portal screen.
 */
export function NationalAnnouncements() {
  const { claims } = useAuth();
  const canPost = canPostNationalAnnouncements(claims?.roles ?? []);

  const listQuery = useQuery({
    queryKey: ["national-announcements"],
    queryFn: () => api.get<Paged<Announcement>>("/api/announcements/national?skip=0&take=100"),
    enabled: canPost,
    retry: false,
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function handlePost(e: FormEvent) {
    e.preventDefault();
    setPostError(null);

    if (!title.trim() || !body.trim()) {
      setPostError("Title and body are required.");
      return;
    }

    setPosting(true);
    try {
      await api.post<AnnouncementCreated>("/api/announcements/national", {
        title: title.trim(), body: body.trim(), isUrgent, expiryDate: expiryDate || null,
      });
      setTitle(""); setBody(""); setIsUrgent(false); setExpiryDate("");
      await listQuery.refetch();
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPosting(false);
    }
  }

  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  function openWithdraw(announcementId: number) {
    setWithdrawError(null);
    setReason("");
    setWithdrawingId(announcementId);
  }

  async function confirmWithdraw() {
    if (withdrawingId === null) return;
    if (reason.trim().length < 10) { setWithdrawError("At least 10 characters — this will be shown to anyone who still has it open."); return; }

    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      await api.post(`/api/announcements/national/${withdrawingId}/withdraw`, { reason: reason.trim() });
      setWithdrawingId(null);
      await listQuery.refetch();
    } catch (err) {
      setWithdrawError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setWithdrawBusy(false);
    }
  }

  if (!canPost) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only National Council can post an announcement to every chapter."
      />
    );
  }

  const items = listQuery.data?.items ?? [];

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>National announcements</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Posted here, it shows up on every chapter member's own dashboard, badged "National" —
        with a push alert to anyone who hasn't turned that off.
      </p>

      <form onSubmit={e => { void handlePost(e); }} style={formCardStyle}>
        <label htmlFor="title" style={labelStyle}>Title</label>
        <input
          id="title" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Annual convention registration now open" style={fieldStyle}
        />

        <label htmlFor="body" style={labelStyle}>Body</label>
        <textarea
          id="body" value={body} onChange={e => setBody(e.target.value)} rows={5}
          placeholder="Write the announcement" style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        <label style={toggleRowStyle}>
          <input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} />
          <span>This is urgent</span>
        </label>

        <label htmlFor="expiryDate" style={labelStyle}>Expires (optional)</label>
        <input
          id="expiryDate" type="date" value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)} style={fieldStyle}
        />

        {postError && <p role="alert" style={errorStyle}>{postError}</p>}

        <button type="submit" disabled={posting} style={{ ...buttonStyle, opacity: posting ? 0.7 : 1 }}>
          {posting ? "Posting…" : "Post to every chapter"}
        </button>
      </form>

      {listQuery.isLoading && <ScreenSkeleton rows={4} />}
      {listQuery.error && <ErrorState message={(listQuery.error as Error).message} onRetry={() => listQuery.refetch()} />}

      {!listQuery.isLoading && !listQuery.error && (
        items.length === 0 ? (
          <EmptyState title="Nothing posted yet" body="Announcements you post here will appear in this list." />
        ) : (
          <div style={{ marginTop: 20 }}>
            {items.map(a => (
              <div key={a.announcementId} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {a.isUrgent && !a.isWithdrawn && <span style={urgentPillStyle}>Urgent</span>}
                    {a.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 3 }}>
                    {shortDate(a.publishDateUtc)}
                    {a.expiryDate && ` · Expires ${shortDate(a.expiryDate)}`}
                  </div>
                  {a.isWithdrawn ? (
                    <div style={withdrawnBannerStyle}>
                      Withdrawn{a.withdrawnDateUtc ? ` on ${shortDate(a.withdrawnDateUtc)}` : ""}
                      {a.withdrawnReason ? ` — ${a.withdrawnReason}` : ""}
                    </div>
                  ) : (
                    <div style={bodyPreviewStyle}>{a.body}</div>
                  )}

                  {withdrawingId === a.announcementId && (
                    <div style={{ marginTop: 10 }}>
                      <input
                        value={reason} onChange={e => setReason(e.target.value)}
                        placeholder="Reason for withdrawing" style={promptInputStyle} autoFocus
                      />
                      {withdrawError && <p role="alert" style={errorStyle}>{withdrawError}</p>}
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          type="button" onClick={() => { void confirmWithdraw(); }} disabled={withdrawBusy}
                          style={{ ...ghostButtonStyle, background: "var(--deep)", color: "var(--brass-soft)" }}
                        >
                          {withdrawBusy ? "…" : "Confirm withdraw"}
                        </button>
                        <button type="button" onClick={() => setWithdrawingId(null)} disabled={withdrawBusy} style={ghostButtonStyle}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {!a.isWithdrawn && withdrawingId !== a.announcementId && (
                  <button type="button" onClick={() => openWithdraw(a.announcementId)} style={ghostButtonStyle}>
                    Withdraw
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

const formCardStyle: CSSProperties = {
  marginTop: 16, padding: 16, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
};

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 14,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const toggleRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, marginTop: 14, minHeight: "var(--tap)", fontSize: 14,
};

const errorStyle: CSSProperties = { marginTop: 10, fontSize: 12.5, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 18, minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
};

const rowStyle: CSSProperties = {
  display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px",
  background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r)", marginBottom: 10,
};

const bodyPreviewStyle: CSSProperties = {
  fontSize: 12.5, color: "var(--slate)", marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap",
};

const withdrawnBannerStyle: CSSProperties = {
  marginTop: 6, fontSize: 12.5, color: "var(--mute)", fontStyle: "italic", lineHeight: 1.5,
};

const urgentPillStyle: CSSProperties = {
  display: "inline-block", marginRight: 6, fontSize: 10.5, padding: "2px 8px", borderRadius: 10,
  background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--slate)", fontSize: 12.5, flex: "none",
};

const promptInputStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 14,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};
