import { useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type DownloadedFile } from "@/shared/api";
import { pesoSigned, shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canVoidMoney } from "@/shared/roles";
import type { ExpenseDetail as ExpenseDetailModel } from "@/shared/types";

interface VoidResponse { expenseId: number; reversedLedgerEntryId: number | null }

/**
 * GET /api/chapters/{chapterId}/expenses/{expenseId}. A nonexistent/wrong-chapter id
 * and a bad id in the URL both resolve to the same plain "not found" message — same
 * anti-enumeration posture as usp_Expense_Get / MeetingDetail.
 *
 * Receipt attachments open through GET /api/chapters/{chapterId}/expenses/{expenseId}/
 * attachments/{attachmentId} — a separate, expense-scoped download route, because
 * dbo.ExpenseAttachment.AttachmentId (what this screen's data uses) is a different id
 * space from AttachmentStagingId (what the general GET /api/attachments/{id} route
 * expects). Fetched as a Blob rather than a plain <a href> because the access token
 * lives in memory, not a cookie the browser would send on a bare navigation.
 */
export function ExpenseDetail({ chapterId }: { chapterId: number }) {
  const { expenseId: idParam } = useParams<{ expenseId: string }>();
  const expenseId = Number(idParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canVoid = canVoidMoney(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["expense", chapterId, expenseId],
    queryFn: () => api.get<ExpenseDetailModel>(`/api/chapters/${chapterId}/expenses/${expenseId}`),
    enabled: Number.isFinite(expenseId),
    retry: false,
  });

  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  if (!Number.isFinite(expenseId)) {
    return <EmptyState title="This expense could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This expense could not be found"
          body="It may have been removed, or you may not have access to it."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={6} />;

  async function viewAttachment(attachmentId: number) {
    setViewError(null);
    setViewingId(attachmentId);
    try {
      const file: DownloadedFile = await api.download(
        `/api/chapters/${chapterId}/expenses/${expenseId}/attachments/${attachmentId}`,
      );
      const url = URL.createObjectURL(file.blob);
      // A new tab, not a forced save — a receipt photo/PDF is meant to be looked at.
      // The tab owns the object URL; browsers release it when the tab is closed, and
      // there is no reliable earlier moment to revoke it ourselves without racing the
      // tab's own load.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setViewError(err instanceof ApiError ? err.message : "Could not open that receipt. Please try again.");
    } finally {
      setViewingId(null);
    }
  }

  async function handleVoid(e: FormEvent) {
    e.preventDefault();
    setVoidError(null);
    setVoiding(true);
    try {
      await api.post<VoidResponse>(`/api/chapters/${chapterId}/expenses/${expenseId}/void`, { reason });
      setVoidOpen(false);
      setReason("");
      await refetch();
    } catch (err) {
      // Surfaces the server's own message verbatim — its own "at least 10 characters"
      // rule, or a 409 if it was already voided since this screen loaded.
      setVoidError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.15, letterSpacing: ".02em" }}>
          {data.payee}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>
          {shortDate(data.expenseDate)}
          {data.categoryName ? ` · ${data.categoryName}` : ""}
          {data.activityName ? ` · ${data.activityName}` : ""}
        </div>

        <div className="num out" style={{ fontSize: 24, fontWeight: 600, marginTop: 12 }}>
          {pesoSigned(data.amount, "Out")}
        </div>

        {data.description && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--slate)", marginTop: 12, whiteSpace: "pre-wrap" }}>
            {data.description}
          </div>
        )}

        {/* Voided is a normal historical state, not an alarm — same tone as a withdrawn
            announcement, never hidden. */}
        {data.isVoided && (
          <div style={voidedBannerStyle}>
            This expense has been voided. See "Void history" below for the reason.
          </div>
        )}

        <p style={{ fontSize: 12, color: "var(--slate)", marginTop: 14, lineHeight: 1.6 }}>
          This posted to the chapter's ledger as one entry.{" "}
          <Link to="/ledger" style={{ color: "var(--info)" }}>View the ledger</Link>
        </p>
      </div>

      <div style={{ padding: "0 16px" }}>
        <div style={sectionLabelStyle}>Receipts</div>
      </div>

      {data.attachments.length === 0 ? (
        <p style={{ padding: "0 16px 16px", fontSize: 12.5, color: "var(--mute)" }}>
          No receipt is on file for this expense.
        </p>
      ) : (
        <div style={{ padding: "0 16px 16px" }}>
          {data.attachments.map(att => (
            <div key={att.attachmentId} style={attachmentRowStyle}>
              <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {att.fileName}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--mute)", flex: "none" }}>
                {(att.fileSize / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={() => { void viewAttachment(att.attachmentId); }}
                disabled={viewingId === att.attachmentId}
                style={viewLinkStyle}
              >
                {viewingId === att.attachmentId ? "Opening…" : "View"}
              </button>
            </div>
          ))}
          {viewError && <p role="alert" style={errorTextStyle}>{viewError}</p>}
        </div>
      )}

      {canVoid && !data.isVoided && (
        <div style={{ padding: 16 }}>
          {!voidOpen ? (
            <button type="button" onClick={() => setVoidOpen(true)} style={ghostButtonStyle}>
              Void this expense
            </button>
          ) : (
            <form onSubmit={e => { void handleVoid(e); }}>
              <label htmlFor="voidReason" style={labelStyle}>Reason for voiding</label>
              <textarea
                id="voidReason" value={reason} onChange={e => setReason(e.target.value)}
                rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
              />
              <p style={hintStyle}>At least 10 characters — this will be shown to the whole chapter.</p>

              {voidError && <p role="alert" style={errorTextStyle}>{voidError}</p>}

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => { setVoidOpen(false); setReason(""); setVoidError(null); }}
                  style={ghostButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={voiding || reason.trim().length < 10}
                  style={{ ...primaryButtonStyle, opacity: voiding ? 0.7 : 1 }}
                >
                  {voiding ? "Voiding…" : "Void expense"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Transparency, not an officer tool — every member of the chapter sees this. */}
      {data.voidHistory.length > 0 && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={sectionLabelStyle}>Void history</div>
          <div>
            {data.voidHistory.map(v => (
              <div key={v.expenseVoidId} style={historyRowStyle}>
                <div style={{ fontSize: 12, color: "var(--mute)" }}>
                  {shortDate(v.voidedDateUtc)} · {shortTime(v.voidedDateUtc)}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.55 }}>
                  {v.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "14px 0 8px",
};

const attachmentRowStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
  padding: "10px 12px", background: "var(--paper)", border: "1px solid var(--line)",
  borderRadius: "var(--r)", marginBottom: 6,
};

const viewLinkStyle: CSSProperties = {
  fontSize: 12, color: "var(--info)", textDecoration: "underline", flex: "none",
};

const voidedBannerStyle: CSSProperties = {
  marginTop: 12, padding: 12, borderRadius: "var(--r)", fontSize: 13, lineHeight: 1.6,
  color: "var(--slate)", background: "var(--bond)", border: "1px solid var(--line)",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorTextStyle: CSSProperties = { fontSize: 13, color: "var(--out)", lineHeight: 1.5, marginBottom: 10 };

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
};

const historyRowStyle: CSSProperties = {
  padding: "10px 0", borderBottom: "1px solid var(--line)",
};
