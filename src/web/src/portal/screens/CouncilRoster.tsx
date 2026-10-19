import { useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { ResponsiveTable } from "../responsive";
import { canSeatCouncilOfficers, canViewCouncilRegistry } from "@/shared/roles";
import {
  COUNCIL_OFFICES, type CouncilMemberLookup, type CouncilOfficerCandidate, type CouncilRegistry,
  type CouncilRoster as CouncilRosterData, type CouncilSeatResult, type SeatCouncilOfficerRequest,
} from "@/shared/types";

/**
 * One council's own officer roster — every seat (current and ended), and its permanent
 * dbo.SeatOverride history. Reached from the registry via "View / manage officers".
 *
 * canViewCouncilRegistry (any real council office) gates viewing; canSeatCouncilOfficers
 * (CouncilAdmin) additionally gates the seat/unseat actions themselves — the server
 * re-derives the caller's REAL authority for both (usp_Council_ResolveSeatingAuthority)
 * regardless of what this screen shows, same "coarse client check, real server check"
 * posture as every other council screen.
 *
 * Honesty rules enforced here, not decoration:
 *   - A vacant office reads "Vacant" plainly — never a blank row, never a zero.
 *   - An out-of-jurisdiction seat carries a permanent, visible badge with its recorded
 *     reason and who seated him — never the words "approved", "waived" or "exception"
 *     (invariant #13b).
 *   - Past terms remain visible, never hidden once a seat ends.
 *   - A lapsed or no-mobile-number candidate is shown as such before selection, not
 *     discovered only after a failed submit.
 */
export function CouncilRoster() {
  const { councilId: councilIdParam } = useParams<{ councilId: string }>();
  const councilId = Number(councilIdParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canView = canViewCouncilRegistry(roles);
  const canSeat = canSeatCouncilOfficers(roles);

  const focusQuery = useQuery({
    queryKey: ["council-focus", councilId],
    queryFn: () => api.get<CouncilRegistry[]>(`/api/councils?councilId=${councilId}`),
    enabled: canView,
  });
  const rosterQuery = useQuery({
    queryKey: ["council-roster", councilId],
    queryFn: () => api.get<CouncilRosterData>(`/api/councils/${councilId}/officers`),
    enabled: canView,
  });

  const [seatingOfficeId, setSeatingOfficeId] = useState<number | null>(null);
  const [unseatingRoleId, setUnseatingRoleId] = useState<number | null>(null);
  const [unseatReason, setUnseatReason] = useState("");
  const [unseatBusy, setUnseatBusy] = useState(false);
  const [unseatError, setUnseatError] = useState<string | null>(null);
  const [seatResult, setSeatResult] = useState<CouncilSeatResult | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function confirmUnseat(memberRoleId: number) {
    if (!unseatReason.trim()) { setUnseatError("A reason is required."); return; }
    setUnseatBusy(true);
    setUnseatError(null);
    try {
      await api.del(`/api/councils/${councilId}/officers/${memberRoleId}`, { reason: unseatReason.trim() });
      setUnseatingRoleId(null);
      await rosterQuery.refetch();
      await focusQuery.refetch();
    } catch (err) {
      setUnseatError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setUnseatBusy(false);
    }
  }

  if (!canView) {
    return <EmptyState title="You don't have access to this" body="Only a seated council officer can view this roster." />;
  }
  if (focusQuery.isLoading || rosterQuery.isLoading) return <ScreenSkeleton rows={6} />;
  if (focusQuery.error) return <ErrorState message={(focusQuery.error as Error).message} onRetry={() => focusQuery.refetch()} />;
  if (rosterQuery.error) return <ErrorState message={(rosterQuery.error as Error).message} onRetry={() => rosterQuery.refetch()} />;

  const focus = focusQuery.data?.find(r => r.councilId === councilId);
  const roster = rosterQuery.data;
  if (!focus || !roster) return null;

  const currentSeats = roster.seats.filter(s => s.isCurrent);
  const endedSeats = roster.seats.filter(s => !s.isCurrent);
  // Only the first of each gets a guide marker (data-tour).
  const firstSeatedRoleId = COUNCIL_OFFICES.map(o => currentSeats.find(s => s.councilOfficeId === o.councilOfficeId)).find(Boolean)?.memberRoleId;
  const firstVacantOfficeId = COUNCIL_OFFICES.find(o => !currentSeats.some(s => s.councilOfficeId === o.councilOfficeId))?.councilOfficeId;

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>{focus.councilName}</h1>
      <p style={{ fontSize: 13, color: "var(--mute)", marginTop: 4 }}>{focus.levelName}</p>

      {!focus.hasSeatedOfficers && (
        <div data-tour="roster-dormant" style={{ ...cardStyle, borderColor: "var(--warn)" }}>
          <p style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.6, margin: 0 }}>
            {focus.neverConstituted
              ? "No officers seated yet — this council was created automatically so that a chapter had somewhere to belong."
              : "Dormant — its officers' terms have ended."}
            {" "}Renewals beneath this council cannot be approved until it is reconstituted.
          </p>
        </div>
      )}

      {seatResult && (
        <div style={{ ...cardStyle, borderColor: "var(--brass)" }}>
          <div style={{ fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".03em", color: "var(--in)" }}>
            Seated
          </div>
          {seatResult.enrolmentUrl ? (
            <>
              <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
                He has no account yet — copy this link now and send it to him yourself. This is the only
                time it will ever be shown.
              </p>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--bond)", border: "1px solid var(--line)", fontSize: 12.5, wordBreak: "break-all", color: "var(--ink)" }}>
                {seatResult.enrolmentUrl}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(seatResult.enrolmentUrl!)
                      .then(() => setLinkCopied(true)).catch(() => { /* clipboard denied */ });
                  }}
                  style={ghostButtonStyle}
                >
                  {linkCopied ? "Copied" : "Copy link"}
                </button>
                <button type="button" onClick={() => setSeatResult(null)} style={primaryButtonStyle}>
                  I've saved this — dismiss
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
                He already has an account — no new link was needed.
              </p>
              <button type="button" onClick={() => setSeatResult(null)} style={primaryButtonStyle}>Dismiss</button>
            </>
          )}
        </div>
      )}

      <div style={sectionLabelStyle} data-tour="roster-officers">Officers</div>
      {COUNCIL_OFFICES.map(office => {
        const seat = currentSeats.find(s => s.councilOfficeId === office.councilOfficeId);
        const override = seat ? roster.overrides.find(o => o.memberRoleId === seat.memberRoleId) : undefined;
        return (
          <div key={office.councilOfficeId} style={cardStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
                <div style={{ fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".02em" }}>{office.officeName}</div>
                {seat ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{seat.giftName}</div>
                    <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
                      {seat.fullName} · {seat.memberNumber} · {seat.homeChapterName ?? "No home chapter on file"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 4 }}>
                      Seated {shortDate(seat.termStart)} · {seat.hasAccount ? "Has an account" : "No account yet"}
                    </div>
                    {override && (
                      <div style={overrideBadgeStyle}>
                        Seated from outside this council's own jurisdiction, permanently recorded.
                        Reason: "{override.reason}" — by {override.seatedByGiftName} on {shortDate(override.seatedOnUtc)}.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--mute)", marginTop: 6 }}>Vacant</div>
                )}
              </div>
              {canSeat && (
                seat ? (
                  <button type="button" onClick={() => { setUnseatingRoleId(seat.memberRoleId); setUnseatReason(""); setUnseatError(null); }} style={ghostButtonStyle}
                    data-tour={seat.memberRoleId === firstSeatedRoleId ? "roster-unseat-first" : undefined}>
                    Unseat
                  </button>
                ) : (
                  <button type="button" onClick={() => setSeatingOfficeId(office.councilOfficeId)} style={ghostButtonStyle}
                    data-tour={office.councilOfficeId === firstVacantOfficeId ? "roster-seat-first" : undefined}>
                    Seat someone
                  </button>
                )
              )}
            </div>

            {unseatingRoleId === seat?.memberRoleId && seat && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>
                  Unseating {seat.giftName}. A reason is required and recorded.
                </p>
                <input value={unseatReason} onChange={e => setUnseatReason(e.target.value)} placeholder="Reason" style={fieldStyle} autoFocus />
                {unseatError && <p role="alert" style={errorStyle}>{unseatError}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => { void confirmUnseat(seat.memberRoleId); }} disabled={unseatBusy} style={primaryButtonStyle}>
                    {unseatBusy ? "…" : "Confirm unseat"}
                  </button>
                  <button type="button" onClick={() => setUnseatingRoleId(null)} disabled={unseatBusy} style={ghostButtonStyle}>Cancel</button>
                </div>
              </div>
            )}

            {seatingOfficeId === office.councilOfficeId && (
              <SeatOfficerPanel
                councilId={councilId} councilOfficeId={office.councilOfficeId} officeName={office.officeName}
                onClose={() => setSeatingOfficeId(null)}
                onSeated={async result => {
                  setSeatResult(result);
                  setLinkCopied(false);
                  setSeatingOfficeId(null);
                  await rosterQuery.refetch();
                  await focusQuery.refetch();
                }}
              />
            )}
          </div>
        );
      })}

      {endedSeats.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Past officers</div>
          <ResponsiveTable
            rows={endedSeats}
            rowKey={s => s.memberRoleId}
            columns={[
              { key: "office", header: "Office", primary: true, render: s => s.officeName ?? "—" },
              { key: "officer", header: "Officer", render: s => `${s.giftName} — ${s.memberNumber}` },
              { key: "term", header: "Term", numeric: true, render: s => `${shortDate(s.termStart)} – ${s.termEnd ? shortDate(s.termEnd) : "—"}` },
            ]}
          />
        </>
      )}

      {roster.overrides.length > 0 && (
        <>
          <div style={sectionLabelStyle} data-tour="roster-overrides">Outside-jurisdiction seatings on record</div>
          <p style={{ fontSize: 12, color: "var(--mute)", marginBottom: 8, lineHeight: 1.6 }}>
            A permanent record — never a waiver, never removed, regardless of whether the seat itself has
            since ended.
          </p>
          <ResponsiveTable
            rows={roster.overrides}
            rowKey={o => o.seatOverrideId}
            columns={[
              { key: "officer", header: "Officer", primary: true, render: o => `${o.giftName} — ${o.memberNumber}` },
              { key: "chapter", header: "Home chapter", render: o => o.homeChapterName ?? "No home chapter on file" },
              { key: "reason", header: "Reason", render: o => o.reason },
              { key: "by", header: "Seated by", render: o => o.seatedByGiftName },
              { key: "date", header: "Date", numeric: true, render: o => shortDate(o.seatedOnUtc) },
            ]}
          />
        </>
      )}
    </div>
  );
}

function SeatOfficerPanel({ councilId, councilOfficeId, officeName, onClose, onSeated }: {
  councilId: number; councilOfficeId: number; officeName: string;
  onClose: () => void; onSeated: (result: CouncilSeatResult) => void;
}) {
  const [mode, setMode] = useState<"search" | "lookup">("search");
  const [search, setSearch] = useState("");
  const [lookupName, setLookupName] = useState("");
  const [lookupMobile, setLookupMobile] = useState("");
  const [lookupResults, setLookupResults] = useState<CouncilMemberLookup[] | null>(null);
  const [selected, setSelected] = useState<CouncilOfficerCandidate | CouncilMemberLookup | null>(null);
  const [termStart, setTermStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [outsideReason, setOutsideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const candidatesQuery = useQuery({
    queryKey: ["council-eligible", councilId, search],
    queryFn: () => api.get<CouncilOfficerCandidate[]>(
      `/api/councils/${councilId}/eligible-officers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    enabled: mode === "search",
  });

  async function runLookup() {
    const nameText = lookupName.trim();
    const mobileText = lookupMobile.trim();
    if (!nameText || !mobileText) { setError("Enter both his name and his mobile number."); return; }
    setLookupBusy(true);
    setError(null);
    setSelected(null);
    try {
      const rows = await api.get<CouncilMemberLookup[]>(
        `/api/councils/member-lookup?councilId=${councilId}&name=${encodeURIComponent(nameText)}&mobileNo=${encodeURIComponent(mobileText)}`);
      setLookupResults(rows);
      const only = rows.length === 1 ? rows[0] : undefined;
      if (only) setSelected(only);
    } catch (err) {
      setLookupResults(null);
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLookupBusy(false);
    }
  }

  function switchMode(next: "search" | "lookup") {
    setMode(next);
    setSelected(null);
    setLookupResults(null);
    setError(null);
  }

  const isOutside = mode === "lookup" && selected !== null;

  async function handleSeat() {
    if (!selected) { setError("Choose a member first."); return; }
    if (selected.isLapsed) { setError("This brother's renewal has lapsed. A lapsed officer cannot be seated."); return; }
    if (isOutside && !outsideReason.trim()) {
      setError("A reason is required for seating someone from outside this council's own jurisdiction.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const req: SeatCouncilOfficerRequest = {
        memberId: selected.memberId, councilOfficeId, termStart, termEnd: null,
        outsideJurisdictionReason: isOutside ? outsideReason.trim() : null,
      };
      const result = await api.post<CouncilSeatResult>(`/api/councils/${councilId}/officers`, req);
      onSeated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>Seat {officeName}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={() => switchMode("search")}
          style={mode === "search" ? tabActiveStyle : tabStyle}>From this jurisdiction</button>
        <button type="button" onClick={() => switchMode("lookup")}
          style={mode === "lookup" ? tabActiveStyle : tabStyle}>From all records</button>
      </div>

      {mode === "search" ? (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" style={fieldStyle} />
          {candidatesQuery.isLoading && <p style={hintStyle}>Loading candidates…</p>}
          <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
            {(candidatesQuery.data ?? []).map(c => (
              <button
                key={c.memberId} type="button" onClick={() => setSelected(c)}
                style={{ ...candidateRowStyle, ...(selected?.memberId === c.memberId ? candidateRowSelectedStyle : {}) }}
              >
                <span>{c.giftName} — {c.fullName}</span>
                <span style={{ fontSize: 11, color: "var(--mute)" }}>
                  {c.chapterName}
                  {c.isLapsed && " · Renewal lapsed"}
                  {!c.isLapsed && !c.isCurrent && " · Not yet renewed"}
                  {c.noMobileNumber && " · No mobile number on file"}
                </span>
              </button>
            ))}
            {candidatesQuery.data?.length === 0 && <p style={hintStyle}>No candidates found.</p>}
          </div>
        </>
      ) : (
        <>
          <p style={{ ...hintStyle, marginTop: 0, marginBottom: 8, lineHeight: 1.6 }}>
            Ask the brother for his name and the mobile number he registered with. Both must match.
          </p>
          <form
            onSubmit={e => { e.preventDefault(); void runLookup(); }}
            style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          >
            <input
              value={lookupName} onChange={e => setLookupName(e.target.value)}
              placeholder="Name or gift name" aria-label="Name or gift name" autoComplete="off"
              style={{ ...fieldStyle, flex: "1 1 220px", width: "auto", minWidth: 0 }}
            />
            <input
              value={lookupMobile} onChange={e => setLookupMobile(e.target.value)}
              placeholder="Mobile number (e.g. 0917 123 4567)" aria-label="Mobile number"
              inputMode="tel" autoComplete="off"
              style={{ ...fieldStyle, flex: "1 1 220px", width: "auto", minWidth: 0 }}
            />
            <button type="submit" disabled={lookupBusy} style={ghostButtonStyle}>
              {lookupBusy ? "…" : "Look up"}
            </button>
          </form>
          {lookupResults && lookupResults.length === 0 && (
            <p style={hintStyle}>No member found with that name and mobile number. Check both and try again.</p>
          )}
          {lookupResults && lookupResults.length > 1 && (
            <p style={hintStyle}>More than one brother uses this number. Choose the right one.</p>
          )}
          <div style={{ marginTop: 8 }}>
            {(lookupResults ?? []).map(r => (
              <button
                key={r.memberId} type="button" onClick={() => setSelected(r)}
                style={{ ...candidateRowStyle, ...(selected?.memberId === r.memberId ? candidateRowSelectedStyle : {}) }}
              >
                <span>{r.giftName} — {r.memberNumber}</span>
                <span style={{ fontSize: 11, color: "var(--mute)" }}>
                  {r.chapterName ?? "No chapter on file"} · {r.statusName}
                  {r.isLapsed && " · Renewal lapsed"}
                  {!r.isLapsed && !r.isCurrent && " · Not yet renewed"}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {isOutside && selected && (
        <>
          <p style={{ fontSize: 12, color: "var(--warn)", marginTop: 10, lineHeight: 1.6 }}>
            You may seat him. The reason you give is recorded permanently and everyone can see it.
          </p>
          <input value={outsideReason} onChange={e => setOutsideReason(e.target.value)} placeholder="Reason" style={fieldStyle} />
        </>
      )}

      <label htmlFor="termStart" style={labelStyle}>Seated from</label>
      <input id="termStart" type="date" value={termStart} onChange={e => setTermStart(e.target.value)} style={fieldStyle} />

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
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

const overrideBadgeStyle: CSSProperties = {
  marginTop: 8, padding: "8px 10px", borderRadius: 8, fontSize: 11.5, lineHeight: 1.6,
  background: "#FBF4E4", color: "var(--warn)", border: "1px solid #E7D6A8",
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

const tabStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 22, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--slate)",
};

const tabActiveStyle: CSSProperties = { ...tabStyle, background: "var(--deep)", color: "var(--brass-soft)" };

const candidateRowStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left",
  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)",
  marginBottom: 6, fontSize: 13, minHeight: "var(--tap)", overflowWrap: "anywhere",
};

const candidateRowSelectedStyle: CSSProperties = { borderColor: "var(--brass)", background: "var(--bond)" };
