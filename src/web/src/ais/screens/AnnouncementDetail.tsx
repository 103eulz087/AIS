import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteComms } from "@/shared/roles";
import type { Announcement, ReadReceipt } from "@/shared/types";

/**
 * There is no GET-by-id endpoint for a single announcement — only
 * GET /api/chapters/{chapterId}/announcements (the chapter's list). This screen
 * fetches that list (including withdrawn ones, so a link to a since-withdrawn
 * post still resolves) and finds the row locally rather than trying to invent a
 * backend call that doesn't exist.
 *
 * Marks itself read once, on mount, via POST /api/documents/Announcement/{id}/read
 * — fire-and-forget, but a real failure shows a small non-blocking note rather
 * than being swallowed silently.
 */
export function AnnouncementDetail({ chapterId }: { chapterId: number }) {
  const { announcementId: idParam } = useParams<{ announcementId: string }>();
  const announcementId = Number(idParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteComms(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["announcements-source", chapterId],
    queryFn: () => api.get<Paged<Announcement>>(
      `/api/chapters/${chapterId}/announcements?take=500&includeWithdrawn=true`),
    enabled: Number.isFinite(announcementId),
  });

  const announcement = data?.items.find(a => a.announcementId === announcementId) ?? null;

  const [readNotice, setReadNotice] = useState<string | null>(null);
  const markedRef = useRef(false);
  useEffect(() => {
    if (!Number.isFinite(announcementId) || markedRef.current) return;
    markedRef.current = true;
    api.post(`/api/documents/Announcement/${announcementId}/read`).catch(() => {
      setReadNotice("Could not record that you've opened this. It's only used for the read count officers see.");
    });
  }, [announcementId]);

  const receipts = useQuery({
    queryKey: ["announcement-read-receipts", announcementId],
    queryFn: () => api.get<ReadReceipt[]>(`/api/documents/Announcement/${announcementId}/read-receipts`),
    enabled: isOfficer && Number.isFinite(announcementId),
  });

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  if (!Number.isFinite(announcementId)) {
    return <EmptyState title="This announcement could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (!announcement) {
    return (
      <EmptyState
        title="This announcement could not be found"
        body="It may have been removed, or you may not have access to it."
      />
    );
  }

  async function handleWithdraw(e: FormEvent) {
    e.preventDefault();
    setWithdrawError(null);
    setWithdrawing(true);
    try {
      await api.post(`/api/chapters/${chapterId}/announcements/${announcementId}/withdraw`, { reason });
      setWithdrawOpen(false);
      setReason("");
      await refetch();
    } catch (err) {
      // Surfaces the server's own message verbatim — its own length rule, or a
      // 409 if it was already withdrawn since this screen loaded.
      setWithdrawError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setWithdrawing(false);
    }
  }

  const isLiveUrgent = announcement.isUrgent && !announcement.isWithdrawn;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 16 }}>
        {isLiveUrgent && (
          <span style={urgentPillStyle}>
            {announcement.urgentTypeName === "BloodRequest"
              ? `Urgent · blood request${announcement.bloodTypeName ? ` · ${announcement.bloodTypeName}` : ""}`
              : "Urgent · assistance needed"}
          </span>
        )}

        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.2, marginTop: isLiveUrgent ? 10 : 0 }}>
          {announcement.title}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>
          {shortDate(announcement.publishDateUtc)}
          {announcement.editedDateUtc && ` · Edited ${shortDate(announcement.editedDateUtc)}`}
          {announcement.expiryDate && ` · Expires ${shortDate(announcement.expiryDate)}`}
        </div>

        {announcement.isWithdrawn && (
          <div style={withdrawnBannerStyle}>
            Withdrawn{announcement.withdrawnDateUtc ? ` on ${shortDate(announcement.withdrawnDateUtc)}` : ""}
            {announcement.withdrawnReason ? ` — ${announcement.withdrawnReason}` : ""}
          </div>
        )}

        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--slate)", marginTop: 14, whiteSpace: "pre-wrap" }}>
          {announcement.body}
        </div>

        {readNotice && <p style={noticeStyle}>{readNotice}</p>}
      </div>

      {isOfficer && !announcement.isWithdrawn && (
        <div style={{ display: "flex", gap: 10, padding: "0 16px 16px" }}>
          <Link to={`/announcements/${announcementId}/edit`} style={ghostButtonStyle}>Edit</Link>
          {!withdrawOpen && (
            <button type="button" onClick={() => setWithdrawOpen(true)} style={ghostButtonStyle}>
              Withdraw
            </button>
          )}
        </div>
      )}

      {isOfficer && withdrawOpen && (
        <div style={{ padding: "0 16px 16px" }}>
          <form onSubmit={e => { void handleWithdraw(e); }}>
            <label htmlFor="withdrawReason" style={labelStyle}>Reason for withdrawing</label>
            <textarea
              id="withdrawReason" value={reason} onChange={e => setReason(e.target.value)}
              rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
            />
            <p style={hintStyle}>At least 10 characters — this will be shown to the whole chapter.</p>

            {withdrawError && <p role="alert" style={errorTextStyle}>{withdrawError}</p>}

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => { setWithdrawOpen(false); setReason(""); setWithdrawError(null); }}
                style={ghostButtonStyle}
              >
                Cancel
              </button>
              <button
                type="submit" disabled={withdrawing || reason.trim().length < 10}
                style={{ ...primaryButtonStyle, opacity: withdrawing ? 0.7 : 1 }}
              >
                {withdrawing ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isOfficer && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={sectionLabelStyle}>Who's read this</div>
          {receipts.isLoading && <ScreenSkeleton rows={2} />}
          {receipts.error && (
            <ErrorState message={(receipts.error as Error).message} onRetry={() => receipts.refetch()} />
          )}
          {receipts.data && receipts.data.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--mute)" }}>Nobody has opened this yet.</p>
          )}
          {receipts.data && receipts.data.length > 0 && (
            <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
              {receipts.data.map(r => (
                <div key={r.memberId} style={receiptRowStyle}>
                  <span style={{ fontSize: 13.5 }}>{r.giftName}</span>
                  <span style={{ fontSize: 11.5, color: "var(--mute)" }}>
                    {shortDate(r.readDateUtc)} · {shortTime(r.readDateUtc)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const urgentPillStyle: CSSProperties = {
  display: "inline-block", fontSize: 11, padding: "3px 10px", borderRadius: 12,
  background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8",
};

const withdrawnBannerStyle: CSSProperties = {
  marginTop: 12, padding: 12, borderRadius: "var(--r)", fontSize: 13, lineHeight: 1.6,
  color: "var(--slate)", background: "var(--bond)", border: "1px solid var(--line)",
};

const noticeStyle: CSSProperties = { fontSize: 11.5, color: "var(--mute)", marginTop: 14, lineHeight: 1.5 };

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "0 0 8px",
};

const receiptRowStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 12px", borderBottom: "1px solid var(--line)",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorTextStyle: CSSProperties = { fontSize: 13, color: "var(--out)", lineHeight: 1.5, marginTop: 10 };

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)", textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
  display: "inline-flex", alignItems: "center",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
};
