import { useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteDiscipline } from "@/shared/roles";
import {
  CORRECTIVE_ACTION_STATUSES, hasNarrative, timelineEntryHasDetail,
  type CorrectiveActionCaseResponse,
} from "@/shared/types";

function statusPillStyle(statusName: string): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block", fontSize: 10.5, padding: "3px 9px", borderRadius: 10, whiteSpace: "nowrap",
  };
  switch (statusName) {
    case "Pending":
      return { ...base, background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8" };
    case "Under Review":
      return { ...base, background: "#EFF4F9", color: "var(--info)", border: "1px solid var(--line)" };
    default:
      return { ...base, background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)" };
  }
}

/**
 * GET /api/chapters/{chapterId}/corrective-actions/{caseId}. Renders whichever of the
 * two shapes the API actually returned (CLAUDE.md invariant #6) — the narrative
 * section, the resolution notes and "filed by" are rendered only when those keys are
 * actually present on `case`, via hasNarrative(), never via a null check; the same is
 * true per-entry for the timeline, via timelineEntryHasDetail(). A summary-shape case
 * renders no lock icon, no "restricted" badge and no placeholder — the honest look of
 * a complete, ordinary public record, exactly the same visual treatment the shared
 * fields get on a detail-shape case.
 *
 * A 404 — a bad id, or a case belonging to a chapter this caller doesn't belong to,
 * the API does not distinguish — renders the same plain "not found" state either way
 * (mirrors MeetingDetail/ApplicationDetail's anti-enumeration pattern).
 *
 * "Add update" is ChapterAdmin-only (canWriteDiscipline). There is no edit or delete
 * anywhere on this screen: a filed narrative can never be changed, only the case's
 * status, by appending a new timeline entry.
 */
export function CaseDetail({ chapterId }: { chapterId: number }) {
  const { caseId: caseIdParam } = useParams<{ caseId: string }>();
  const caseId = Number(caseIdParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canUpdate = canWriteDiscipline(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["corrective-action", chapterId, caseId],
    queryFn: () => api.get<CorrectiveActionCaseResponse>(
      `/api/chapters/${chapterId}/corrective-actions/${caseId}`),
    enabled: Number.isFinite(caseId),
    retry: false,
  });

  const [updateOpen, setUpdateOpen] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [notes, setNotes] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (!Number.isFinite(caseId)) {
    return <EmptyState title="This case could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={8} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This case could not be found"
          body="It may have been removed, or you may not have access to it."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={8} />;

  const c = data.case;
  const timeline = data.timeline ?? [];

  async function handleAddUpdate(e: FormEvent) {
    e.preventDefault();
    setUpdateError(null);
    if (!newStatusName) {
      setUpdateError("Choose a new status.");
      return;
    }
    setUpdating(true);
    try {
      await api.post(`/api/chapters/${chapterId}/corrective-actions/${caseId}/updates`, {
        newStatusName, notes: notes.trim() || null,
      });
      setUpdateOpen(false);
      setNewStatusName("");
      setNotes("");
      await refetch();
    } catch (err) {
      setUpdateError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.15, letterSpacing: ".02em" }}>
          {c.giftName}
        </div>
        <div className="num" style={{ fontSize: 12, color: "var(--mute)", marginTop: 4 }}>
          {c.memberNumber}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          <Field label="Category" value={c.categoryName} />
          <div>
            <div style={{ fontSize: 11, color: "var(--mute)" }}>Status</div>
            <div style={{ marginTop: 3 }}>
              <span style={statusPillStyle(c.statusName)}>{c.statusName}</span>
            </div>
          </div>
          <Field label="Date filed" value={shortDate(c.dateFiled)} />
          {c.resolutionDate && <Field label="Resolved" value={shortDate(c.resolutionDate)} />}
          {/* filedByGiftName is only present when the caller can see the narrative —
              rendered exactly when the key exists, never inferred otherwise. */}
          {hasNarrative(c) && <Field label="Filed by" value={c.filedByGiftName} />}
        </div>
      </div>

      {/* The narrative section is entirely absent from the DOM when hasNarrative(c) is
          false — not present-with-empty-text, not present-but-hidden. This is the WHOLE
          story a bystander is entitled to; there is no placeholder for what he cannot
          see, because that placeholder would itself be a disclosure. */}
      {hasNarrative(c) && (
        <div style={{ padding: "0 16px" }}>
          <div style={sectionLabelStyle}>What happened</div>
          <div style={cardStyle}>
            <p style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
              {c.content}
            </p>
          </div>

          {c.resolutionNotes && (
            <>
              <div style={sectionLabelStyle}>Resolution notes</div>
              <div style={cardStyle}>
                <p style={{ fontSize: 13.5, color: "var(--slate)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {c.resolutionNotes}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {canUpdate && (
        <div style={{ padding: 16 }}>
          {!updateOpen ? (
            <button type="button" onClick={() => setUpdateOpen(true)} style={ghostButtonStyle}>
              Add update
            </button>
          ) : (
            <form onSubmit={e => { void handleAddUpdate(e); }} style={updateFormStyle}>
              <label htmlFor="newStatusName" style={labelStyle}>New status</label>
              <select
                id="newStatusName" value={newStatusName}
                onChange={e => setNewStatusName(e.target.value)} style={fieldStyle}
              >
                <option value="">Choose a status</option>
                {CORRECTIVE_ACTION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <label htmlFor="updateNotes" style={labelStyle}>Notes (optional)</label>
              <textarea
                id="updateNotes" value={notes} onChange={e => setNotes(e.target.value)}
                rows={3} style={{ ...fieldStyle, height: "auto", padding: 12 }}
              />
              <p style={hintStyle}>Notes are visible to officers and to the brother concerned only.</p>

              {updateError && <p role="alert" style={errorTextStyle}>{updateError}</p>}

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => { setUpdateOpen(false); setNewStatusName(""); setNotes(""); setUpdateError(null); }}
                  style={ghostButtonStyle}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={updating || !newStatusName}
                  style={{ ...primaryButtonStyle, opacity: updating ? 0.7 : 1 }}
                >
                  {updating ? "Saving…" : "Save update"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div style={{ padding: "0 16px 16px" }}>
        <div style={sectionLabelStyle}>Status history</div>
        <div>
          {timeline.map(t => (
            <div key={t.updateId} style={historyRowStyle}>
              <div style={{ fontSize: 12, color: "var(--mute)" }}>
                {shortDate(t.updateDateUtc)} · {shortTime(t.updateDateUtc)} · {t.statusName}
                {/* updatedByGiftName is present only when this entry carries the detail
                    shape — rendered per-entry, from the entry's own keys, never from a
                    single page-level flag decided once for the whole timeline. */}
                {timelineEntryHasDetail(t) && ` · ${t.updatedByGiftName}`}
              </div>
              {timelineEntryHasDetail(t) && t.notes && (
                <div style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.55 }}>
                  {t.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <p style={{ padding: "0 16px", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.6 }}>
        Records here are never deleted. Corrections are added to the timeline so the
        history stays whole.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--mute)" }}>{label}</div>
      <div style={{ fontSize: 13.5, color: "var(--ink)", marginTop: 1 }}>{value}</div>
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

const historyRowStyle: CSSProperties = { padding: "8px 0", borderBottom: "1px solid var(--line)" };

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", marginBottom: 12,
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

const updateFormStyle: CSSProperties = {
  marginTop: 4, padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--brass)",
};
