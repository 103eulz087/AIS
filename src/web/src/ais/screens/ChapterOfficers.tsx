import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canSeatChapterOfficers } from "@/shared/roles";
import {
  CHAPTER_OFFICES, isSameChapter, type ChapterOfficerRosterSeat, type ChapterOfficerSeatResult,
  type DirectoryRow, type Member, type SeatChapterOfficerRequest,
} from "@/shared/types";
import { PRESIDENT_OFFICE_ID } from "./ChapterOfficerFields";

/**
 * A chapter's own officer roster, with immediate seat/unseat per office — distinct from
 * OfficerRoster.tsx's annual Turnover filing (a full-roster petition the council reviews
 * end to end). This is the quick, day-to-day tool; Turnover remains the once-a-year,
 * whole-roster-at-once one. Both stay, on purpose — different situations.
 *
 * Client decision (2026-09-22): a chapter's own President may seat or unseat any officer
 * EXCEPT himself — that one seat can only be acted on by the council above the chapter
 * (usp_Chapter_SeatOfficer/_UnseatOfficer's own split). This screen renders the
 * President's own row read-only, with no action buttons, regardless of role — there is
 * no path from here to act on that seat; a council officer replacing a chapter's
 * President does so from the council's own side, not this screen.
 *
 * canSeatChapterOfficers (ChapterAdmin OR CouncilAdmin) gates the whole screen coarsely;
 * the server re-derives the real, narrower authority independently either way.
 */
export function ChapterOfficers() {
  const { claims } = useAuth();
  const chapterId = claims?.chapterId;
  const roles = claims?.roles ?? [];
  const canSeat = canSeatChapterOfficers(roles);

  const rosterQuery = useQuery({
    queryKey: ["chapter-officer-roster", chapterId],
    queryFn: () => api.get<ChapterOfficerRosterSeat[]>(`/api/chapters/${chapterId}/officers`),
    enabled: canSeat && !!chapterId,
  });

  const [seatingOfficeId, setSeatingOfficeId] = useState<number | null>(null);
  const [unseatingRoleId, setUnseatingRoleId] = useState<number | null>(null);
  const [unseatReason, setUnseatReason] = useState("");
  const [unseatBusy, setUnseatBusy] = useState(false);
  const [unseatError, setUnseatError] = useState<string | null>(null);

  async function confirmUnseat(memberRoleId: number) {
    if (!unseatReason.trim()) { setUnseatError("A reason is required."); return; }
    setUnseatBusy(true);
    setUnseatError(null);
    try {
      await api.del(`/api/chapters/${chapterId}/officers/${memberRoleId}`, { reason: unseatReason.trim() });
      setUnseatingRoleId(null);
      await rosterQuery.refetch();
    } catch (err) {
      setUnseatError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setUnseatBusy(false);
    }
  }

  if (!canSeat) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only this chapter's own President can manage its officer roster."
      />
    );
  }

  if (rosterQuery.isLoading) return <ScreenSkeleton rows={6} />;
  if (rosterQuery.error) {
    return <ErrorState message={(rosterQuery.error as Error).message} onRetry={() => rosterQuery.refetch()} />;
  }

  const roster = rosterQuery.data ?? [];
  const currentSeats = roster.filter(s => s.isCurrent);
  const endedSeats = roster.filter(s => !s.isCurrent);

  return (
    <div style={{ padding: "20px 16px 40px" }}>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>Chapter officers</h1>
      <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 6, lineHeight: 1.6 }}>
        Seat or unseat an officer right away — this is separate from the annual officer update, which
        replaces the whole roster at once and goes to your council.
      </p>

      <div style={sectionLabelStyle}>Officers</div>
      {CHAPTER_OFFICES.map(office => {
        const seat = currentSeats.find(s => s.officeId === office.officeId);
        const isPresident = office.officeId === PRESIDENT_OFFICE_ID;
        return (
          <div key={office.officeId} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div style={{ fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".02em" }}>{office.officeName}</div>
                {seat ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{seat.giftName}</div>
                    <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
                      {seat.fullName} · {seat.memberNumber}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 4 }}>
                      Seated {shortDate(seat.termStart)} · {seat.hasAccount ? "Has an account" : "No account yet"}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--mute)", marginTop: 6 }}>Vacant</div>
                )}
              </div>
              {isPresident ? (
                <span style={presidentNoteStyle}>Only your council can change this seat</span>
              ) : (
                seat ? (
                  <button type="button" onClick={() => { setUnseatingRoleId(seat.memberRoleId); setUnseatReason(""); setUnseatError(null); }} style={ghostButtonStyle}>
                    Unseat
                  </button>
                ) : (
                  <button type="button" onClick={() => setSeatingOfficeId(office.officeId)} style={ghostButtonStyle}>
                    Seat someone
                  </button>
                )
              )}
            </div>

            {unseatingRoleId === seat?.memberRoleId && seat && !isPresident && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>
                  Unseating {seat.giftName}. A reason is required and recorded.
                </p>
                <input value={unseatReason} onChange={e => setUnseatReason(e.target.value)} placeholder="Reason" style={fieldStyle} autoFocus />
                {unseatError && <p role="alert" style={errorStyle}>{unseatError}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => { void confirmUnseat(seat.memberRoleId); }} disabled={unseatBusy} style={primaryButtonStyle}>
                    {unseatBusy ? "…" : "Confirm unseat"}
                  </button>
                  <button type="button" onClick={() => setUnseatingRoleId(null)} disabled={unseatBusy} style={ghostButtonStyle}>Cancel</button>
                </div>
              </div>
            )}

            {seatingOfficeId === office.officeId && !isPresident && chapterId && (
              <SeatOfficerPanel
                chapterId={chapterId} officeId={office.officeId} officeName={office.officeName}
                onClose={() => setSeatingOfficeId(null)}
                onSeated={async () => {
                  setSeatingOfficeId(null);
                  await rosterQuery.refetch();
                }}
              />
            )}
          </div>
        );
      })}

      {endedSeats.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Past officers</div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Office</th>
                  <th style={thStyle}>Officer</th>
                  <th style={thStyle}>Term</th>
                </tr>
              </thead>
              <tbody>
                {endedSeats.map(s => (
                  <tr key={s.memberRoleId}>
                    <td style={tdStyle}>{s.officeName}</td>
                    <td style={tdStyle}>{s.giftName} — {s.memberNumber}</td>
                    <td style={tdStyle} className="num">{shortDate(s.termStart)} – {s.termEnd ? shortDate(s.termEnd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SeatOfficerPanel({ chapterId, officeId, officeName, onClose, onSeated }: {
  chapterId: number; officeId: number; officeName: string;
  onClose: () => void; onSeated: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [termStart, setTermStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["own-chapter-members-for-seat", search],
    // usp_Member_Search's own validator caps Take at 200 (MemberSearchRequestValidator) —
    // the repository clamps to the same 200 regardless, so this is the real ceiling.
    queryFn: () => api.get<Paged<DirectoryRow>>(`/api/members?take=200${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  // No chapterId supplied above, so every row back is same-chapter (Member) shape —
  // narrowed explicitly rather than assumed, same guard OfficerRoster.tsx's own picker uses.
  const candidates = (membersQuery.data?.items ?? []).filter(isSameChapter);

  async function handleSeat() {
    if (!selected) { setError("Choose a member first."); return; }

    setSubmitting(true);
    setError(null);
    try {
      const req: SeatChapterOfficerRequest = { memberId: selected.memberId, officeId, termStart };
      await api.post<ChapterOfficerSeatResult>(`/api/chapters/${chapterId}/officers`, req);
      onSeated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>Seat {officeName}</p>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" style={fieldStyle} />
      {membersQuery.isLoading && <p style={hintStyle}>Loading members…</p>}
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
        {candidates.map(m => (
          <button
            key={m.memberId} type="button" onClick={() => setSelected(m)}
            style={{ ...candidateRowStyle, ...(selected?.memberId === m.memberId ? candidateRowSelectedStyle : {}) }}
          >
            <span>{m.giftName}{m.fullName ? ` — ${m.fullName}` : ""}</span>
            <span style={{ fontSize: 11, color: "var(--mute)" }}>
              {m.memberNumber}
              {m.isCurrent === false && " · Renewal not current"}
            </span>
          </button>
        ))}
        {membersQuery.data && candidates.length === 0 && <p style={hintStyle}>No members found.</p>}
      </div>

      <label htmlFor="termStart" style={labelStyle}>Seated from</label>
      <input id="termStart" type="date" value={termStart} onChange={e => setTermStart(e.target.value)} style={fieldStyle} />

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={() => { void handleSeat(); }} disabled={submitting || !selected} style={primaryButtonStyle}>
          {submitting ? "…" : "Confirm seat"}
        </button>
        <button type="button" onClick={onClose} disabled={submitting} style={ghostButtonStyle}>Cancel</button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
  marginTop: 10,
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "18px 0 4px",
};

const presidentNoteStyle: CSSProperties = {
  fontSize: 11, color: "var(--mute)", maxWidth: 120, textAlign: "right", lineHeight: 1.4,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 14,
  border: "1px solid var(--line)", background: "var(--bond)", color: "var(--ink)",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 12 };

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorStyle: CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--out)", lineHeight: 1.5 };

const primaryButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 12.5,
};

const candidateRowStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left",
  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)",
  marginBottom: 6, fontSize: 13,
};

const candidateRowSelectedStyle: CSSProperties = { borderColor: "var(--brass)", background: "var(--bond)" };

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)", minWidth: 480,
};

const thStyle: CSSProperties = {
  textAlign: "left", fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};
