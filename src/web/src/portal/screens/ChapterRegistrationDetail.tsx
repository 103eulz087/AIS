import { useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canApproveChapterRegistrations, canReissueEnrolmentLink, canReviewChapterRegistrations } from "@/shared/roles";
import type {
  ApproveChapterRegistrationResponse, ChapterRegistrationDetail as ChapterRegistrationDetailModel,
  ChapterRegistrationOfficer, ReissueMemberEnrolmentLinkResponse,
} from "@/shared/types";

function statusLabel(name: string): string {
  switch (name) {
    case "Submitted": return "Submitted";
    case "ReturnedForCorrection": return "Returned for correction";
    case "Approved": return "Approved";
    default: return name;
  }
}

function typeLabel(name: string): string {
  return name === "Charter" ? "New chapter petition" : "Annual officer update";
}

/** Plain-English rendering of dbo.ApprovalRouting's own short reason codes
 * ('Parent' / 'ParentDoesNotExist' / 'ParentDormant' — usp_Approval_Routing.sql). Shown
 * only when routing actually diverted this registration away from its intended council —
 * the ordinary "Parent" case needs no special callout. */
function routingExplanation(reason: string, intendedCouncilName: string | null, actingCouncilName: string): string | null {
  switch (reason) {
    case "ParentDormant":
      return `Approved here because ${intendedCouncilName ?? "the parent council"} currently has no seated officers.`;
    case "ParentDoesNotExist":
      return `Approved here because the parent council does not exist yet.`;
    case "Parent":
      return null;
    default:
      return `Approved by ${actingCouncilName} rather than ${intendedCouncilName ?? "the usual council"} (${reason}).`;
  }
}

/**
 * GET /api/chapter-registrations/{id} — full registration header, 8 officers with
 * verification state, status history and routing record, for a council officer seated
 * on the acting council. Anti-enumeration: the server throws the SAME "not found" for a
 * nonexistent id and for one acting at a council this caller has no standing over, so a
 * 404 here is rendered as one plain message either way.
 *
 * canReviewChapterRegistrations (CouncilSecretary or CouncilAdmin) gates the whole
 * screen. Within it, canApproveChapterRegistrations (CouncilAdmin only) additionally
 * gates the Approve action alone — a Secretary sees the full checklist and can verify
 * every officer, but the Approve button itself is disabled with a stated reason for him.
 * The server enforces the real gate regardless (usp_ChapterRegistration_Approve's own
 * "Only this council's President may give final approval" check) — canApprove here only
 * decides what to SHOW.
 *
 * POST .../officers/{officerId}/verify, .../return and .../approve act on this
 * registration. Approve's response carries the enrolment link(s) SHOW-ONCE: Charter -> a
 * single link for the incoming President; Turnover -> one link per newly-enrolled
 * incoming officer. Held only in this component's local state, never persisted, never
 * refetched — there is no endpoint to recover a lost link.
 */
export function ChapterRegistrationDetail() {
  const { registrationId: idParam } = useParams<{ registrationId: string }>();
  const registrationId = Number(idParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canReview = canReviewChapterRegistrations(roles);
  const canApprove = canApproveChapterRegistrations(roles);
  const canReissue = canReissueEnrolmentLink(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["chapter-registration", registrationId],
    queryFn: () => api.get<ChapterRegistrationDetailModel>(`/api/chapter-registrations/${registrationId}`),
    enabled: canReview && Number.isFinite(registrationId),
    retry: false,
  });

  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveChapterRegistrationResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  // "Resend enrolment link" for an already-decided registration whose officer never
  // redeemed his first one (e.g. it expired, or he lost it) — a council officer here is
  // usp_Enrolment_Issue's "Bounded Council Issuer" branch, not the ordinary Chapter Admin
  // path MemberDirectory.tsx's own identical action uses. SHOW-ONCE per member, same as
  // the approve panel above: held only in local state, never persisted, never refetched.
  const [reissuingMemberId, setReissuingMemberId] = useState<number | null>(null);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [reissueResults, setReissueResults] = useState<Record<number, ReissueMemberEnrolmentLinkResponse>>({});
  const [reissueCopiedId, setReissueCopiedId] = useState<number | null>(null);

  if (!canReview) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a council secretary or council admin can review chapter registrations."
      />
    );
  }

  if (!Number.isFinite(registrationId)) {
    return <EmptyState title="This registration could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={8} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This registration could not be found"
          body="It may not exist, or you may not have standing over the council reviewing it."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={8} />;

  const verifiedCount = data.officers.filter(o => o.verifiedBy !== null).length;
  const allVerified = data.officers.length > 0 && verifiedCount === data.officers.length;
  const canDecide = data.statusName === "Submitted";
  const routingNote = data.routing
    ? routingExplanation(data.routing.routingReason, data.intendedCouncilName, data.actingCouncilName)
    : (data.routingReason && data.routingReason !== "Parent"
      ? routingExplanation(data.routingReason, data.intendedCouncilName, data.actingCouncilName)
      : null);

  async function handleVerify(officer: ChapterRegistrationOfficer, verified: boolean) {
    setVerifyError(null);
    setVerifyingId(officer.registrationOfficerId);
    try {
      await api.post(`/api/chapter-registrations/${registrationId}/officers/${officer.registrationOfficerId}/verify`, {
        verified, note: (noteDrafts[officer.registrationOfficerId] ?? officer.verifyNote ?? "").trim() || null,
      });
      await refetch();
    } catch (err) {
      setVerifyError(err instanceof ApiError ? err.message : "Could not update that officer. Please try again.");
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleApprove() {
    setApproveError(null);
    setApproving(true);
    try {
      const res = await api.post<ApproveChapterRegistrationResponse>(
        `/api/chapter-registrations/${registrationId}/approve`, {},
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
      await api.post(`/api/chapter-registrations/${registrationId}/return`, { reason: returnReason });
      setReturnOpen(false);
      setReturnReason("");
      await refetch();
    } catch (err) {
      setReturnError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setReturning(false);
    }
  }

  async function handleReissueLink(memberId: number) {
    setReissueError(null);
    setReissuingMemberId(memberId);
    try {
      const res = await api.post<ReissueMemberEnrolmentLinkResponse>(`/api/members/${memberId}/enrolment-link`, {});
      setReissueResults(prev => ({ ...prev, [memberId]: res }));
      setReissueCopiedId(null);
    } catch (err) {
      // 403 here means this council seat has no standing over that member's chapter, or
      // (usp_Enrolment_Issue's own rule) he already has an account — surfaced verbatim,
      // same anti-guessing posture as everywhere else a 403 reaches the UI unchanged.
      setReissueError(err instanceof ApiError ? err.message : "Could not issue a new link. Please try again.");
    } finally {
      setReissuingMemberId(null);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text)
      .then(() => setCopiedKey(key))
      .catch(() => { /* clipboard permission denied — the link is still on screen */ });
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 24, lineHeight: 1.15, letterSpacing: ".02em" }}>
          {data.chapterName ?? data.proposedChapterName ?? "Chapter registration"}
        </div>
        <div style={{ fontSize: 13, color: "var(--slate)", marginTop: 4 }}>{typeLabel(data.registrationType)}</div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 8 }}>
          <span className="num">{data.referenceNo}</span> · Submitted {shortDate(data.submittedDateUtc)}
          {data.submittedByGiftName ? ` by ${data.submittedByGiftName}` : ""}
          {" · "}<span style={pillStyle}>{statusLabel(data.statusName)}</span>
        </div>
      </div>

      {routingNote && (
        <div style={routingBoxStyle}>{routingNote}</div>
      )}

      {approveResult && !dismissed && (
        <ApproveResultPanel
          result={approveResult} officers={data.officers}
          copiedKey={copiedKey} onCopy={copy} onDismiss={() => setDismissed(true)}
        />
      )}

      {data.registrationType === "Charter" && (
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Location</div>
          <div style={cardStyle}>
            <Field label="Barangay" value={data.barangay ?? "—"} />
            {data.accentName && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4, background: data.hexValue ?? "var(--line)", flex: "none",
                }} />
                <span style={{ fontSize: 13, color: "var(--ink)" }}>Chapter mark accent: {data.accentName}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={sectionLabelStyle}>Officers</div>
          <div style={{ fontSize: 12.5, color: allVerified ? "var(--in)" : "var(--mute)" }}>
            {verifiedCount} of {data.officers.length} verified
          </div>
        </div>

        {verifyError && <p role="alert" style={errorTextStyle}>{verifyError}</p>}
        {reissueError && <p role="alert" style={errorTextStyle}>{reissueError}</p>}

        {data.officers.map(o => {
          // The real member id an approved officer resolves to: MemberId for a Turnover
          // seat (an already-existing member, linked from filing), CreatedMemberId for a
          // Charter seat (typed-in at filing, a Member row only comes to exist at
          // approval — usp_ChapterRegistration_Approve.sql only ever sets THIS column for
          // that branch, never MemberId, since the seat was never a linked member to
          // begin with). Never both populated for the same registration type, but check
          // MemberId first so this keeps working if a Turnover officer is ever combined
          // with this same code path.
          const targetMemberId = o.memberId ?? o.createdMemberId;
          return (
            <OfficerRow
              key={o.registrationOfficerId} officer={o}
              noteDraft={noteDrafts[o.registrationOfficerId] ?? o.verifyNote ?? ""}
              onNoteChange={v => setNoteDrafts(prev => ({ ...prev, [o.registrationOfficerId]: v }))}
              busy={verifyingId === o.registrationOfficerId}
              canAct={canDecide}
              onVerify={verified => { void handleVerify(o, verified); }}
              canReissue={canReissue && !canDecide}
              targetMemberId={targetMemberId}
              reissuing={targetMemberId !== null && reissuingMemberId === targetMemberId}
              reissueResult={targetMemberId !== null ? reissueResults[targetMemberId] : undefined}
              reissueCopied={targetMemberId !== null && reissueCopiedId === targetMemberId}
              onReissue={() => { if (targetMemberId !== null) void handleReissueLink(targetMemberId); }}
              onCopyReissued={() => {
                if (targetMemberId === null) return;
                const url = reissueResults[targetMemberId]?.enrolmentUrl;
                if (!url) return;
                navigator.clipboard?.writeText(url)
                  .then(() => setReissueCopiedId(targetMemberId))
                  .catch(() => { /* clipboard permission denied — the link is still on screen */ });
              }}
            />
          );
        })}
      </div>

      {data.decisionReason && !canDecide && (
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Decision</div>
          <div style={cardStyle}>
            <p style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6 }}>{data.decisionReason}</p>
          </div>
        </div>
      )}

      {canDecide && (
        <div style={sectionStyle}>
          {approveError && <p role="alert" style={errorTextStyle}>{approveError}</p>}

          {!canApprove ? (
            <p style={approveGateNoteStyle}>
              Only a council admin (president) can give final approval. You can verify officers and
              return this for correction, but the Approve action isn't available to you.
            </p>
          ) : !confirmingApprove ? (
            <button
              type="button" disabled={!allVerified}
              title={allVerified ? undefined : `${verifiedCount} of ${data.officers.length} verified — every officer must be verified first.`}
              onClick={() => setConfirmingApprove(true)}
              style={{ ...primaryButtonStyle, opacity: allVerified ? 1 : 0.5, cursor: allVerified ? "pointer" : "not-allowed" }}
            >
              Approve
            </button>
          ) : (
            <div style={confirmPanelStyle}>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                {data.registrationType === "Charter"
                  ? "This charters the chapter and issues a one-time enrolment link for the incoming president."
                  : "This closes the outgoing officers' terms and issues a one-time enrolment link for each newly-enrolled incoming officer."}
                {" "}The link is shown only once, right after you approve — have a way to copy and
                send it ready before you continue.
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
                Return with a remark
              </button>
            ) : (
              <form onSubmit={e => { void handleReturn(e); }} style={{ marginTop: 10 }}>
                <label htmlFor="returnReason" style={labelStyle}>Reason for returning</label>
                <textarea
                  id="returnReason" value={returnReason} onChange={e => setReturnReason(e.target.value)}
                  rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
                />
                <p style={hintStyle}>At least 10 characters — this will be shown to the chapter.</p>

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
                    {returning ? "Returning…" : "Return with a remark"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {data.history.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Status history</div>
          <div>
            {data.history.map(h => (
              <div key={h.chapterRegistrationUpdateId} style={historyRowStyle}>
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

function OfficerRow({
  officer: o, noteDraft, onNoteChange, busy, canAct, onVerify,
  canReissue, targetMemberId, reissuing, reissueResult, reissueCopied, onReissue, onCopyReissued,
}: {
  officer: ChapterRegistrationOfficer;
  noteDraft: string;
  onNoteChange: (value: string) => void;
  busy: boolean;
  canAct: boolean;
  onVerify: (verified: boolean) => void;
  canReissue: boolean;
  targetMemberId: number | null;
  reissuing: boolean;
  reissueResult: ReissueMemberEnrolmentLinkResponse | undefined;
  reissueCopied: boolean;
  onReissue: () => void;
  onCopyReissued: () => void;
}) {
  const isVerified = o.verifiedBy !== null;
  const fullName = [o.firstName, o.middleName, o.lastName].filter(Boolean).join(" ");

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--mute)" }}>{o.officeName}</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
            {o.giftName}{!o.grantsLogin && <span style={noLoginPillStyle}>Recorded — no login</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 2 }}>{fullName}</div>
          <div className="num" style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
            {o.mobileNo}{o.memberNumber ? ` · ${o.memberNumber}` : ""}
          </div>
        </div>
        <span style={{
          fontSize: 11, padding: "3px 9px", borderRadius: 10, whiteSpace: "nowrap",
          background: isVerified ? "var(--bond)" : "#FBF4E4",
          color: isVerified ? "var(--in)" : "var(--warn)",
          border: `1px solid ${isVerified ? "var(--line)" : "#E7D6A8"}`,
        }}>
          {isVerified ? `Verified · ${o.verifiedByGiftName ?? ""}` : "Not yet verified"}
        </span>
      </div>

      {canAct && (
        <>
          <label htmlFor={`note-${o.registrationOfficerId}`} style={{ ...labelStyle, marginTop: 12 }}>
            Note (optional)
          </label>
          <input
            id={`note-${o.registrationOfficerId}`} value={noteDraft} disabled={busy}
            onChange={e => onNoteChange(e.target.value)} style={fieldStyle}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              type="button" disabled={busy || isVerified} onClick={() => onVerify(true)}
              style={{ ...smallPrimaryButtonStyle, opacity: busy ? 0.7 : 1 }}
            >
              {busy ? "…" : "Verify"}
            </button>
            {isVerified && (
              <button
                type="button" disabled={busy} onClick={() => onVerify(false)}
                style={{ ...ghostButtonStyle, marginTop: 0 }}
              >
                Undo verification
              </button>
            )}
          </div>
        </>
      )}
      {!canAct && o.verifyNote && (
        <p style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 8, lineHeight: 1.5 }}>{o.verifyNote}</p>
      )}

      {/* Only for a seat that resolves to a real member (targetMemberId set — MemberId
          for Turnover, CreatedMemberId for an approved Charter seat) with no account yet.
          An officer who already redeemed his link, or a Charter seat not yet approved
          (no Member row exists at all), is never offered this. The API/procedure
          re-check this independently either way; this is only "should the button appear
          at all". */}
      {canReissue && o.grantsLogin && targetMemberId !== null && !o.hasAccount && (
        reissueResult ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--bond)", border: "1px solid var(--brass)" }}>
            <p style={{ fontSize: 12, color: "var(--slate)" }}>
              New enrolment link issued — copy and send it now, this is the only time it's shown.
            </p>
            <div style={enrolmentLinkRowStyle}>
              <div style={enrolmentLinkBoxStyle}>{reissueResult.enrolmentUrl}</div>
              <button type="button" onClick={onCopyReissued} style={ghostButtonStyle}>
                {reissueCopied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button" disabled={reissuing} onClick={onReissue}
            style={{ ...ghostButtonStyle, marginTop: 12 }}
          >
            {reissuing ? "…" : "Resend enrolment link"}
          </button>
        )
      )}
    </div>
  );
}

function ApproveResultPanel({ result, officers, copiedKey, onCopy, onDismiss }: {
  result: ApproveChapterRegistrationResponse;
  officers: ChapterRegistrationOfficer[];
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div style={approvePanelStyle}>
      <div style={{ fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".03em", color: "var(--in)" }}>
        {result.registrationType === "Charter" ? "Chapter approved" : "Officer update approved"}
      </div>

      {result.charter && (
        <>
          <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
            Member number prefix <span className="num" style={{ fontWeight: 600 }}>{result.charter.memberNumberPrefix}</span> has
            been issued. Copy this enrolment link now and send it to the incoming president yourself —
            this is the only time it will ever be shown.
          </p>
          <div style={enrolmentLinkRowStyle}>
            <div style={enrolmentLinkBoxStyle}>{result.charter.enrolmentUrl}</div>
            <button type="button" onClick={() => onCopy(result.charter!.enrolmentUrl, "charter")} style={ghostButtonStyle}>
              {copiedKey === "charter" ? "Copied" : "Copy link"}
            </button>
          </div>
        </>
      )}

      {result.turnoverEnrolments && (
        result.turnoverEnrolments.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
            Every incoming officer already had an account — no new enrolment links were issued.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
              Copy each link now and send it to that officer yourself — this is the only time these
              will ever be shown. An officer who already had an account is not listed here; his
              account carries over unchanged.
            </p>
            {result.turnoverEnrolments.map(e => {
              const officer = officers.find(o => o.memberId === e.memberId);
              const key = `turnover-${e.memberId}`;
              return (
                <div key={e.memberId} style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {officer ? `${officer.giftName} — ${officer.officeName}` : `Member #${e.memberId}`}
                  </div>
                  <div style={enrolmentLinkRowStyle}>
                    <div style={enrolmentLinkBoxStyle}>{e.enrolmentUrl}</div>
                    <button type="button" onClick={() => onCopy(e.enrolmentUrl, key)} style={ghostButtonStyle}>
                      {copiedKey === key ? "Copied" : "Copy link"}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )
      )}

      <div style={{ marginTop: 14 }}>
        <button type="button" onClick={onDismiss} style={primaryButtonStyle}>I've saved this — dismiss</button>
      </div>
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

const sectionStyle: CSSProperties = { marginTop: 20 };

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "0 0 8px",
};

const cardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", marginBottom: 10,
};

const pillStyle: CSSProperties = {
  display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 10,
  background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const noLoginPillStyle: CSSProperties = {
  marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap",
  background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const routingBoxStyle: CSSProperties = {
  marginTop: 14, padding: 12, borderRadius: "var(--r)", background: "#EAF1F7",
  border: "1px solid #C9DBEA", fontSize: 13, color: "var(--info)", lineHeight: 1.5,
};

const historyRowStyle: CSSProperties = { padding: "8px 0", borderBottom: "1px solid var(--line)" };

const approvePanelStyle: CSSProperties = {
  marginTop: 16, padding: 16, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--brass)",
};

const enrolmentLinkRowStyle: CSSProperties = { display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" };

const enrolmentLinkBoxStyle: CSSProperties = {
  flex: "1 1 260px", padding: 10, borderRadius: 8, background: "var(--bond)",
  border: "1px solid var(--line)", fontSize: 12.5, wordBreak: "break-all", color: "var(--ink)",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorTextStyle: CSSProperties = { fontSize: 13, color: "var(--out)", lineHeight: 1.5, marginBottom: 10 };

const approveGateNoteStyle: CSSProperties = {
  fontSize: 13, color: "var(--slate)", lineHeight: 1.6, padding: 12, borderRadius: "var(--r)",
  background: "var(--bond)", border: "1px solid var(--line)",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};

const smallPrimaryButtonStyle: CSSProperties = {
  minHeight: 38, padding: "0 16px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".05em", textTransform: "uppercase",
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
