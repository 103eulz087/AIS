import { useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canApproveApplications } from "@/shared/roles";
import type { ApproveMembershipApplicationResponse, MembershipApplicationDetail as ApplicationDetailModel } from "@/shared/types";

function statusLabel(name: string): string {
  switch (name) {
    case "PendingApproval": return "Pending approval";
    case "ReturnedForCorrection": return "Returned for correction";
    case "Approved": return "Approved";
    case "Rejected": return "Rejected";
    default: return name;
  }
}

/**
 * GET /api/membership-applications/{id} — full applicant record, for the chapter's own
 * admin only. No chapterId in the route: the server scopes this to the caller's own
 * chapter from the JWT, and returns the SAME "not found" for a nonexistent id and for
 * an application belonging to another chapter (anti-enumeration, mirrors MeetingDetail).
 *
 * ChapterAdmin-only — a plain member or another officer sees a plain "you don't have
 * access" state rather than a 403 crash.
 *
 * POST .../approve, .../return, .../reject act on this application. Approve's response
 * carries the enrolment link SHOW-ONCE: there is no endpoint to re-fetch it, so it is
 * held only in this component's local state, never persisted, never refetched.
 */
export function ApplicationDetail() {
  const { applicationId: idParam } = useParams<{ applicationId: string }>();
  const applicationId = Number(idParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canApprove = canApproveApplications(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["membership-application", applicationId],
    queryFn: () => api.get<ApplicationDetailModel>(`/api/membership-applications/${applicationId}`),
    enabled: canApprove && Number.isFinite(applicationId),
    retry: false,
  });

  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveMembershipApplicationResponse | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  if (!canApprove) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter admin can review membership applications."
      />
    );
  }

  if (!Number.isFinite(applicationId)) {
    return <EmptyState title="This application could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={8} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This application could not be found"
          body="It may have been removed, or you may not have access to it."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={8} />;

  async function handleApprove() {
    setApproveError(null);
    setApproving(true);
    try {
      const res = await api.post<ApproveMembershipApplicationResponse>(
        `/api/membership-applications/${applicationId}/approve`, {},
      );
      setApproveResult(res);
      setConfirmingApprove(false);
      await refetch();
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  async function handleReturn(e: FormEvent) {
    e.preventDefault();
    setReturnError(null);
    setReturning(true);
    try {
      await api.post(`/api/membership-applications/${applicationId}/return`, { reason: returnReason });
      setReturnOpen(false);
      setReturnReason("");
      await refetch();
    } catch (err) {
      // Surfaces the server's own message verbatim — its own "at least 10 characters"
      // rule, or a 409 if this was decided since the page loaded.
      setReturnError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setReturning(false);
    }
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault();
    setRejectError(null);
    setRejecting(true);
    try {
      await api.post(`/api/membership-applications/${applicationId}/reject`, { reason: rejectReason });
      setRejectOpen(false);
      setRejectReason("");
      await refetch();
    } catch (err) {
      setRejectError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setRejecting(false);
    }
  }

  const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" ");
  const canDecide = data.statusName === "PendingApproval";

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.15, letterSpacing: ".02em" }}>
          {data.giftName}
        </div>
        <div style={{ fontSize: 13, color: "var(--slate)", marginTop: 4 }}>{fullName}</div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 8 }}>
          {data.referenceNo} · Submitted {shortDate(data.submittedDateUtc)}{" · "}
          <span style={pillStyle}>{statusLabel(data.statusName)}</span>
        </div>
      </div>

      {approveResult && !dismissed && (
        <div style={approvePanelStyle}>
          <div style={{ fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".03em", color: "var(--in)" }}>
            Application approved
          </div>
          <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
            Member number <span className="num" style={{ fontWeight: 600 }}>{approveResult.memberNumber}</span> has
            been issued. Copy this enrolment link now and send it to the new member yourself — this is the
            only time it will ever be shown. If it is lost, it cannot be recovered here: an application that
            is already Approved cannot be approved again, so this slice has no way to issue a fresh link
            for it.
          </p>
          <div style={enrolmentLinkBoxStyle}>{approveResult.enrolmentUrl}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(approveResult.enrolmentUrl)
                  .then(() => setLinkCopied(true))
                  .catch(() => { /* clipboard permission denied — the link is still on screen */ });
              }}
              style={ghostButtonStyle}
            >
              {linkCopied ? "Copied" : "Copy link"}
            </button>
            <button type="button" onClick={() => setDismissed(true)} style={primaryButtonStyle}>
              I've saved this — dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        <div style={sectionLabelStyle}>Applicant</div>
        <div style={cardStyle}>
          <Field label="Birthdate" value={shortDate(data.birthDate)} />
          <Field label="Mobile" value={data.mobileNo} mono />
          <Field label="Email" value={data.email ?? "—"} />
          <Field label="Date survive" value={data.dateSurvive ? shortDate(data.dateSurvive) : "—"} />
          <Field label="President during survive" value={data.presidentDuringSurvive ?? "—"} />
          <Field label="Master initiator during survive" value={data.masterInitiatorDuringSurvive ?? "—"} />
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>
        <div style={sectionLabelStyle}>Seconder</div>
        <div style={cardStyle}>
          <Field label="Named by applicant" value={data.seconderNameGiven} />
          {data.seconderMemberNumberGiven && (
            <Field label="Member number as given" value={data.seconderMemberNumberGiven} mono />
          )}
          <div style={{ marginTop: 8 }}>
            {data.seconderMemberId ? (
              <span style={{ fontSize: 13, color: "var(--in)" }}>
                Confirmed: {data.seconderResolvedGiftName}
                {data.seconderResolvedMemberNumber ? ` (${data.seconderResolvedMemberNumber})` : ""}
              </span>
            ) : (
              <span style={{ fontSize: 13, color: "var(--mute)" }}>Not yet confirmed</span>
            )}
          </div>
        </div>
      </div>

      {data.priorApplications.length > 0 && (
        <div style={{ padding: "0 16px" }}>
          <div style={sectionLabelStyle}>Prior applications from this mobile number</div>
          <div style={cardStyle}>
            {data.priorApplications.map(p => (
              <div key={p.applicationId} style={historyRowStyle}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {p.referenceNo} · {p.chapterName}
                </div>
                <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
                  {statusLabel(p.statusName)} · Submitted {shortDate(p.submittedDateUtc)}
                  {p.decidedDateUtc ? ` · Decided ${shortDate(p.decidedDateUtc)}` : ""}
                </div>
                {p.decisionReason && (
                  <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 4 }}>{p.decisionReason}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.decisionReason && !canDecide && (
        <div style={{ padding: "0 16px" }}>
          <div style={sectionLabelStyle}>Decision</div>
          <div style={cardStyle}>
            <p style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6 }}>{data.decisionReason}</p>
          </div>
        </div>
      )}

      {canDecide && (
        <div style={{ padding: 16 }}>
          {approveError && <p role="alert" style={errorTextStyle}>{approveError}</p>}

          {!confirmingApprove ? (
            <button type="button" onClick={() => setConfirmingApprove(true)} style={primaryButtonStyle}>
              Approve
            </button>
          ) : (
            <div style={confirmPanelStyle}>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                This creates the member record, generates a member number, and issues a one-time
                enrolment link. The link is shown only once, right after you approve — have a way to
                copy and send it ready before you continue.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button type="button" onClick={() => setConfirmingApprove(false)} style={ghostButtonStyle}>
                  Cancel
                </button>
                <button
                  type="button" disabled={approving}
                  onClick={() => { void handleApprove(); }}
                  style={{ ...primaryButtonStyle, opacity: approving ? 0.7 : 1 }}
                >
                  {approving ? "Approving…" : "Yes, approve"}
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            {!returnOpen ? (
              <button type="button" onClick={() => setReturnOpen(true)} style={ghostButtonStyle}>
                Return for correction
              </button>
            ) : (
              <form onSubmit={e => { void handleReturn(e); }} style={{ marginTop: 10 }}>
                <label htmlFor="returnReason" style={labelStyle}>Reason for returning</label>
                <textarea
                  id="returnReason" value={returnReason} onChange={e => setReturnReason(e.target.value)}
                  rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
                />
                <p style={hintStyle}>At least 10 characters — this will be shown to the applicant.</p>

                {returnError && <p role="alert" style={errorTextStyle}>{returnError}</p>}

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => { setReturnOpen(false); setReturnReason(""); setReturnError(null); }}
                    style={ghostButtonStyle}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit" disabled={returning || returnReason.trim().length < 10}
                    style={{ ...primaryButtonStyle, opacity: returning ? 0.7 : 1 }}
                  >
                    {returning ? "Returning…" : "Return for correction"}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            {!rejectOpen ? (
              <button type="button" onClick={() => setRejectOpen(true)} style={ghostButtonStyle}>
                Reject
              </button>
            ) : (
              <form onSubmit={e => { void handleReject(e); }} style={{ marginTop: 10 }}>
                <label htmlFor="rejectReason" style={labelStyle}>Reason for rejecting</label>
                <textarea
                  id="rejectReason" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
                />
                <p style={hintStyle}>At least 10 characters — this will be shown to the applicant. This is final.</p>

                {rejectError && <p role="alert" style={errorTextStyle}>{rejectError}</p>}

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => { setRejectOpen(false); setRejectReason(""); setRejectError(null); }}
                    style={ghostButtonStyle}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit" disabled={rejecting || rejectReason.trim().length < 10}
                    style={{ ...primaryButtonStyle, opacity: rejecting ? 0.7 : 1 }}
                  >
                    {rejecting ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {data.history.length > 0 && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={sectionLabelStyle}>Status history</div>
          <div>
            {data.history.map(h => (
              <div key={h.membershipApplicationUpdateId} style={historyRowStyle}>
                <div style={{ fontSize: 12, color: "var(--mute)" }}>
                  {shortDate(h.updateDateUtc)} · {shortTime(h.updateDateUtc)} · {statusLabel(h.statusName)}
                </div>
                {h.notes && (
                  <div style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.55 }}>
                    {h.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--mute)" }}>{label}</div>
      <div className={mono ? "num" : undefined} style={{ fontSize: 13.5, color: "var(--ink)", marginTop: 1 }}>
        {value}
      </div>
    </div>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "14px 0 8px",
};

const cardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", marginBottom: 4,
};

const pillStyle: CSSProperties = {
  display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 10,
  background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const historyRowStyle: CSSProperties = { padding: "8px 0", borderBottom: "1px solid var(--line)" };

const approvePanelStyle: CSSProperties = {
  margin: 16, padding: 16, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--brass)",
};

const enrolmentLinkBoxStyle: CSSProperties = {
  marginTop: 10, padding: 10, borderRadius: 8, background: "var(--bond)",
  border: "1px solid var(--line)", fontSize: 12.5,
  wordBreak: "break-all", color: "var(--ink)",
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

const confirmPanelStyle: CSSProperties = {
  marginTop: 10, padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--brass)",
};
