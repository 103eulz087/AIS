import { useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { pesoSigned, shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canVoidMoney } from "@/shared/roles";
import type { DonationDetail as DonationDetailModel } from "@/shared/types";

interface VoidResponse { donationId: number; reversedLedgerEntryId: number | null }

/**
 * GET /api/chapters/{chapterId}/donations/{donationId}. Same anti-enumeration
 * posture as ExpenseDetail/MeetingDetail: a nonexistent id and a wrong-chapter
 * caller both resolve to the same plain "not found" message.
 *
 * This is the strongest transparency artifact this module produces — the donor's
 * name and amount are shown plainly and are meant to be seen. What this screen
 * never shows: any per-donor running total across donations, or a ranking of any
 * kind — a donation is read here entirely on its own.
 */
export function DonationDetail({ chapterId }: { chapterId: number }) {
  const { donationId: idParam } = useParams<{ donationId: string }>();
  const donationId = Number(idParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canVoid = canVoidMoney(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["donation", chapterId, donationId],
    queryFn: () => api.get<DonationDetailModel>(`/api/chapters/${chapterId}/donations/${donationId}`),
    enabled: Number.isFinite(donationId),
    retry: false,
  });

  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  if (!Number.isFinite(donationId)) {
    return <EmptyState title="This donation could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This donation could not be found"
          body="It may have been removed, or you may not have access to it."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={6} />;

  async function handleVoid(e: FormEvent) {
    e.preventDefault();
    setVoidError(null);
    setVoiding(true);
    try {
      await api.post<VoidResponse>(`/api/chapters/${chapterId}/donations/${donationId}/void`, { reason });
      setVoidOpen(false);
      setReason("");
      await refetch();
    } catch (err) {
      setVoidError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setVoiding(false);
    }
  }

  const hasCash = data.amount > 0;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.15, letterSpacing: ".02em" }}>
          {data.donorName}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>
          {shortDate(data.donationDate)}
          {data.donorType ? ` · ${data.donorType}` : ""}
          {data.activityName ? ` · ${data.activityName}` : ""}
        </div>

        {/* isInKind is explicit — a cash amount and an in-kind description can both be
            present at once; both render, and a ₱0 in-kind-only donation never shows a
            peso figure. */}
        {hasCash && (
          <div className="num in" style={{ fontSize: 24, fontWeight: 600, marginTop: 12 }}>
            {pesoSigned(data.amount, "In")}
          </div>
        )}
        {data.isInKind && (
          <div style={{ fontSize: 14, color: "var(--slate)", marginTop: hasCash ? 6 : 12, fontStyle: "italic" }}>
            In kind — {data.inKindDescription}
          </div>
        )}

        {data.chapterReceiptNo && (
          <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 10 }}>
            Chapter receipt no. <span className="num">{data.chapterReceiptNo}</span>
          </div>
        )}

        {data.isVoided && (
          <div style={voidedBannerStyle}>
            This donation has been voided. See "Void history" below for the reason.
          </div>
        )}

        {data.amount > 0 && (
          <p style={{ fontSize: 12, color: "var(--slate)", marginTop: 14, lineHeight: 1.6 }}>
            The cash portion of this donation posted to the chapter's ledger as one entry.{" "}
            <Link to="/ledger" style={{ color: "var(--info)" }}>View the ledger</Link>
          </p>
        )}
      </div>

      {canVoid && !data.isVoided && (
        <div style={{ padding: 16 }}>
          {!voidOpen ? (
            <button type="button" onClick={() => setVoidOpen(true)} style={ghostButtonStyle}>
              Void this donation
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
                  {voiding ? "Voiding…" : "Void donation"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {data.voidHistory.length > 0 && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={sectionLabelStyle}>Void history</div>
          <div>
            {data.voidHistory.map(v => (
              <div key={v.donationVoidId} style={historyRowStyle}>
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
