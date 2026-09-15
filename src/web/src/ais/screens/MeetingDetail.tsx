import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { peso, shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canFinalizeMeetings, canReopenMeetings, canWriteMeetings } from "@/shared/roles";
import { ATTENDANCE_STATUSES, type AttendanceRow, type MeetingDetail as MeetingDetailModel } from "@/shared/types";

interface RowEdit { attendanceStatusId: number | null; fundAmount: string }
type RowEdits = Record<number, RowEdit>;

interface SaveAttendanceResponse {
  meetingId: number; rowsSaved: number; finalized: boolean; ledgerEntryId: number | null;
}

function buildRowEdits(attendance: readonly AttendanceRow[]): RowEdits {
  const out: RowEdits = {};
  for (const a of attendance) {
    out[a.memberId] = {
      attendanceStatusId: a.attendanceStatusId,
      fundAmount: a.fundAmount != null ? a.fundAmount.toFixed(2) : "",
    };
  }
  return out;
}

/**
 * GET /api/chapters/{chapterId}/meetings/{meetingId}.
 *
 * Empty states: a nonexistent/wrong-chapter meeting id and a bad/malformed id in the
 * URL both resolve to the same plain "not found" message — the backend uses one 404
 * for both on purpose (anti-enumeration), and this screen does not try to tell them
 * apart either.
 */
export function MeetingDetail({ chapterId }: { chapterId: number }) {
  const { meetingId: meetingIdParam } = useParams<{ meetingId: string }>();
  const meetingId = Number(meetingIdParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteMeetings(roles);
  const isAdmin = canFinalizeMeetings(roles);
  const isTreasurerOrAdmin = canReopenMeetings(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["meeting", chapterId, meetingId],
    queryFn: () => api.get<MeetingDetailModel>(`/api/chapters/${chapterId}/meetings/${meetingId}`),
    enabled: Number.isFinite(meetingId),
    retry: false,
  });

  const [rows, setRows] = useState<RowEdits>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setRows(buildRowEdits(data.attendance ?? []));
      setInitialized(true);
    }
  }, [data, initialized]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  if (!Number.isFinite(meetingId)) {
    return <EmptyState title="This meeting could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={8} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This meeting could not be found"
          body="It may have been removed, or you may not have access to it."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={8} />;

  const attendance = data.attendance ?? [];
  const reopenHistory = data.reopenHistory ?? [];
  const isFinalized = data.isFinalized;
  const canEdit = !isFinalized && isOfficer;

  const totalToPost = Object.values(rows).reduce(
    (sum, v) => v.attendanceStatusId != null ? sum + (Number(v.fundAmount) || 0) : sum, 0);

  const collectedTotal = attendance.reduce((sum, a) => sum + (a.fundAmount ?? 0), 0);

  async function persist(finalize: boolean) {
    setSaveError(null);
    setSaving(true);
    try {
      const payloadRows = Object.entries(rows)
        .filter(([, v]) => v.attendanceStatusId != null)
        .map(([memberId, v]) => ({
          memberId: Number(memberId),
          attendanceStatusId: v.attendanceStatusId as number,
          fundAmount: v.fundAmount.trim() === "" ? 0 : Number(v.fundAmount),
          checkedInVia: "Manual",
        }));

      await api.put<SaveAttendanceResponse>(
        `/api/chapters/${chapterId}/meetings/${meetingId}/attendance`,
        { rows: payloadRows, finalize },
      );
      await refetch();
      setConfirmingFinalize(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const fresh = await refetch();
        if (fresh.data) setRows(buildRowEdits(fresh.data.attendance ?? []));
        setConflictNotice("This meeting's state changed since you loaded it — showing the current version.");
        setConfirmingFinalize(false);
      } else if (err instanceof ApiError) {
        // Surfaces the server's own message verbatim — e.g. "Only the chapter admin
        // may finalize a meeting," or the reopen-reason length rule.
        setSaveError(err.message);
      } else {
        setSaveError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function clearRow(memberId: number) {
    try {
      await api.del(`/api/chapters/${chapterId}/meetings/${meetingId}/attendance/${memberId}`);
      setRows(r => ({ ...r, [memberId]: { attendanceStatusId: null, fundAmount: "" } }));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not clear that row. Please try again.");
    }
  }

  async function handleReopen(e: FormEvent) {
    e.preventDefault();
    setReopenError(null);
    setReopening(true);
    try {
      await api.post(`/api/chapters/${chapterId}/meetings/${meetingId}/reopen`, { reason: reopenReason });
      setReopenOpen(false);
      setReopenReason("");
      const fresh = await refetch();
      if (fresh.data) setRows(buildRowEdits(fresh.data.attendance ?? []));
    } catch (err) {
      setReopenError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setReopening(false);
    }
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {conflictNotice && (
        <div role="alert" style={conflictBannerStyle}>{conflictNotice}</div>
      )}

      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.15, letterSpacing: ".02em" }}>
          {data.subject}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>
          {shortDate(data.meetingDate)}{data.location ? ` · ${data.location}` : ""}{" · "}
          <span style={isFinalized ? finalizedPillStyle : draftPillStyle}>
            {isFinalized ? "Finalized" : "Draft"}
          </span>
        </div>
        {data.body && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--slate)", marginTop: 12, whiteSpace: "pre-wrap" }}>
            {data.body}
          </div>
        )}
      </div>

      {isFinalized && (
        <div style={collectedCardStyle}>
          <div style={{ fontSize: 11, color: "var(--mute)", letterSpacing: ".08em", textTransform: "uppercase" }}>
            Collected
          </div>
          <div className="num in" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
            {peso(collectedTotal)}
          </div>
          <p style={{ fontSize: 12, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
            This posted to the chapter's ledger as one entry
            {data.ledgerEntryIsReversed
              ? ", which has since been reversed by a reopen (see below)."
              : "."}{" "}
            <Link to="/ledger" style={{ color: "var(--info)" }}>View the ledger</Link>
          </p>
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        <div style={sectionLabelStyle}>Who attended and what each gave</div>
      </div>

      {attendance.length === 0 ? (
        <EmptyState
          title="No members to record attendance for"
          body="Once brothers are approved into this chapter, they appear here automatically."
        />
      ) : (
        <div>
          {attendance.map(a => {
            const edit = rows[a.memberId];
            const effectiveStatusId = canEdit ? (edit?.attendanceStatusId ?? null) : a.attendanceStatusId;
            const effectiveAmount = canEdit
              ? (edit?.fundAmount ?? "")
              : (a.fundAmount != null ? a.fundAmount.toFixed(2) : "");
            const statusLabel = effectiveStatusId != null
              ? (ATTENDANCE_STATUSES.find(s => s.id === effectiveStatusId)?.name ?? "Recorded")
              : "Not recorded";

            return (
              <div key={a.memberId} style={attendanceRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.giftName}</div>
                  <div className="num" style={{ fontSize: 11, color: "var(--mute)", marginTop: 2 }}>
                    {a.memberNumber}
                  </div>
                </div>

                {canEdit ? (
                  <div style={{ display: "flex", gap: 4, flex: "none" }}>
                    {ATTENDANCE_STATUSES.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        aria-label={s.name}
                        aria-pressed={effectiveStatusId === s.id}
                        onClick={() => setRows(r => ({
                          ...r,
                          [a.memberId]: { attendanceStatusId: s.id, fundAmount: r[a.memberId]?.fundAmount ?? "" },
                        }))}
                        style={statusButtonStyle(effectiveStatusId === s.id)}
                      >
                        {s.name.slice(0, 1)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span style={effectiveStatusId != null ? recordedPillStyle : notRecordedPillStyle}>
                    {statusLabel}
                  </span>
                )}

                <AmountCell
                  memberId={a.memberId}
                  editable={canEdit}
                  value={effectiveAmount}
                  onChange={v => setRows(r => ({
                    ...r,
                    [a.memberId]: { attendanceStatusId: r[a.memberId]?.attendanceStatusId ?? null, fundAmount: v },
                  }))}
                />

                {canEdit && a.attendanceStatusId != null && (
                  <button type="button" onClick={() => { void clearRow(a.memberId); }} style={clearLinkStyle}>
                    Clear
                  </button>
                )}
              </div>
            );
          })}

          <p style={noteStyle}>
            A dash means nobody has recorded him yet for this meeting. Contributions are
            voluntary — an amount of ₱0.00 is a normal, complete record, not a missing one.
          </p>
        </div>
      )}

      {!isFinalized && isOfficer && (
        <div style={{ padding: 16 }}>
          <div style={totalCardStyle}>
            <div style={{ fontSize: 11, color: "var(--mute)" }}>Total to post</div>
            <div className="num in" style={{ fontSize: 18, fontWeight: 600 }}>{peso(totalToPost)}</div>
          </div>

          {saveError && <p role="alert" style={errorTextStyle}>{saveError}</p>}

          <button
            type="button" disabled={saving}
            onClick={() => { void persist(false); }}
            style={{ ...secondaryButtonStyle, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          {isAdmin && !confirmingFinalize && (
            <button
              type="button"
              onClick={() => setConfirmingFinalize(true)}
              style={primaryButtonStyle}
            >
              Finalize meeting
            </button>
          )}

          {isAdmin && confirmingFinalize && (
            <div style={confirmPanelStyle}>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                This posts <strong className="num">{peso(totalToPost)}</strong> to the chapter
                funds as one entry, and locks this meeting. If something is wrong afterward, it
                can only be fixed by reopening, which everyone in the chapter will see.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button type="button" onClick={() => setConfirmingFinalize(false)} style={ghostButtonStyle}>
                  Cancel
                </button>
                <button
                  type="button" disabled={saving}
                  onClick={() => { void persist(true); }}
                  style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? "Finalizing…" : "Yes, finalize"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isFinalized && isTreasurerOrAdmin && (
        <div style={{ padding: 16 }}>
          {!reopenOpen ? (
            <button type="button" onClick={() => setReopenOpen(true)} style={ghostButtonStyle}>
              Reopen this meeting
            </button>
          ) : (
            <form onSubmit={e => { void handleReopen(e); }}>
              <label htmlFor="reopenReason" style={labelStyle}>Reason for reopening</label>
              <textarea
                id="reopenReason" value={reopenReason} onChange={e => setReopenReason(e.target.value)}
                rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
              />
              <p style={hintStyle}>At least 10 characters — this will be shown to the whole chapter.</p>

              {reopenError && <p role="alert" style={errorTextStyle}>{reopenError}</p>}

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => { setReopenOpen(false); setReopenReason(""); setReopenError(null); }}
                  style={ghostButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={reopening || reopenReason.trim().length < 10}
                  style={{ ...primaryButtonStyle, opacity: reopening ? 0.7 : 1 }}
                >
                  {reopening ? "Reopening…" : "Reopen"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Transparency, not an officer tool — every member of the chapter sees this,
          not just those who can act on it. */}
      {reopenHistory.length > 0 && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={sectionLabelStyle}>Reopen history</div>
          <div>
            {reopenHistory.map(h => {
              const who = attendance.find(a => a.memberId === h.reopenedBy)?.giftName ?? "an officer";
              return (
                <div key={h.meetingReopenId} style={reopenRowStyle}>
                  <div style={{ fontSize: 12, color: "var(--mute)" }}>
                    {shortDate(h.reopenedDateUtc)} · {shortTime(h.reopenedDateUtc)} · {who}
                  </div>
                  <div style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.55 }}>
                    {h.reason}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AmountCell({ memberId, value, editable, onChange }: {
  memberId: number; value: string; editable: boolean; onChange?: (value: string) => void;
}) {
  // One render path for every amount, regardless of value: a ₱0 row and a ₱300 row
  // must be structurally identical. Never branch this component on the amount itself.
  if (editable) {
    return (
      <input
        data-testid={`amount-${memberId}`}
        className="num"
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={e => onChange?.(e.target.value)}
        style={amountFieldStyle}
      />
    );
  }
  return (
    <span data-testid={`amount-${memberId}`} className="num" style={amountFieldStyle}>
      {peso(value === "" ? null : Number(value))}
    </span>
  );
}

function statusButtonStyle(active: boolean): CSSProperties {
  return {
    minWidth: 34, minHeight: 34, borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: "1px solid var(--line)",
    background: active ? "var(--deep)" : "var(--paper)",
    color: active ? "var(--brass-soft)" : "var(--slate)",
  };
}

const attendanceRowStyle: CSSProperties = {
  display: "flex", gap: 10, alignItems: "center", padding: "10px 16px",
  background: "var(--paper)", borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};

const amountFieldStyle: CSSProperties = {
  width: 84, textAlign: "right", minHeight: 36, padding: "0 8px", borderRadius: 6,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 13.5,
};

const pillBase: CSSProperties = {
  display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap",
};

const draftPillStyle: CSSProperties = {
  ...pillBase, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const finalizedPillStyle: CSSProperties = {
  ...pillBase, background: "var(--deep)", color: "var(--brass-soft)",
};

const recordedPillStyle: CSSProperties = {
  ...pillBase, fontSize: 11.5, padding: "3px 9px",
  background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const notRecordedPillStyle: CSSProperties = {
  ...pillBase, fontSize: 11.5, padding: "3px 9px",
  background: "transparent", color: "var(--mute)", border: "1px dashed var(--line)",
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "14px 0 8px",
};

const collectedCardStyle: CSSProperties = {
  margin: "0 16px 16px", padding: 14, borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--line)",
};

const totalCardStyle: CSSProperties = {
  padding: 14, background: "var(--paper)", border: "1px solid var(--line)",
  borderRadius: "var(--r)", marginBottom: 12,
};

const clearLinkStyle: CSSProperties = {
  fontSize: 11.5, color: "var(--mute)", textDecoration: "underline", flex: "none",
};

const noteStyle: CSSProperties = { padding: "14px 16px", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.6 };

const conflictBannerStyle: CSSProperties = {
  margin: 16, padding: 12, borderRadius: "var(--r)", background: "#FBF4E4",
  border: "1px solid #E7D6A8", color: "var(--warn)", fontSize: 12.5, lineHeight: 1.5,
};

const secondaryButtonStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--ink)",
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".06em", textTransform: "uppercase",
  marginBottom: 10,
};

const primaryButtonStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".06em", textTransform: "uppercase",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};

const confirmPanelStyle: CSSProperties = {
  marginTop: 4, padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--brass)",
};

const errorTextStyle: CSSProperties = { fontSize: 13, color: "var(--out)", lineHeight: 1.5, marginBottom: 10 };

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const reopenRowStyle: CSSProperties = {
  padding: "10px 0", borderBottom: "1px solid var(--line)",
};
