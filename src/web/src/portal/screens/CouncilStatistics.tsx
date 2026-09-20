import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { peso, shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canViewCouncilStatistics } from "@/shared/roles";
import { MEMBER_STATUSES, type ChapterStatisticsDto, type CouncilRollupDto, type CouncilStatisticsResponse } from "@/shared/types";

type PeriodOption = "current" | "lastYear" | "last30" | "custom";
interface DateRange { from?: string; to?: string }
interface Crumb { councilId: number; councilName: string }

const CHAPTERS_TAKE = 25;

/**
 * Council statistics — council-to-council, council-to-chapter, and (via a link into
 * the existing member directory) chapter-to-member visibility, for whichever council
 * an officer is seated on. Reached from PortalShell's nav, gated by
 * canViewCouncilStatistics (CouncilSecretary or CouncilAdmin) — anyone else sees a
 * plain "you don't have access" state, same pattern as every other Portal screen.
 *
 * Endpoints:
 *   GET /api/councils/statistics?from=&to=&skip=&take=            — the caller's own seat
 *   GET /api/councils/{councilId}/statistics?from=&to=&skip=&take= — an explicit focus,
 *     used only when drilling into a child council. The server validates the requested
 *     council against the caller's real scope (dbo.fn_MemberCouncilScope) regardless of
 *     what this screen sends — CLAUDE.md invariant #4/#11, never trusted client-side.
 *
 * Financial figures here are AGGREGATE ONLY per chapter (opening/period-in/period-out/
 * closing balance) — docs/AIS-Project-Documentation.md §3 and §10 Decision #7, amended
 * 2026-09-20. There is no drill-down to an individual ledger entry anywhere on this
 * screen, and there must never be one added without re-reading that amendment first.
 *
 * Honesty rules enforced here, not decoration:
 *   - hasSeatedOfficers=false reads "No officers seated" with the consequence spelled
 *     out, never a blank tile.
 *   - hasRenewalData=false reads "No renewal season recorded yet", never "0% renewed".
 *   - A chapter's balance column is labelled with the date actually applied ("Balance
 *     as at <date>"), never the bare word "Balance" — outside the default (future-
 *     dated) range these are not that chapter's live current balance.
 *   - detachedMemberCount is shown separately from every chapter/member tile, never
 *     folded into a total (invariant #14).
 *   - No ranking, no "top/bottom chapter" framing anywhere (§6.5) — columns sort, but
 *     nothing here declares a winner.
 */
export function CouncilStatistics() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canView = canViewCouncilStatistics(roles);

  const [focusCouncilId, setFocusCouncilId] = useState<number | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [period, setPeriod] = useState<PeriodOption>("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [skip, setSkip] = useState(0);

  const range = rangeFor(period, customFrom, customTo);

  const qs = new URLSearchParams();
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  qs.set("skip", String(skip));
  qs.set("take", String(CHAPTERS_TAKE));

  const path = focusCouncilId
    ? `/api/councils/${focusCouncilId}/statistics?${qs.toString()}`
    : `/api/councils/statistics?${qs.toString()}`;

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["council-statistics", focusCouncilId, range.from ?? null, range.to ?? null, skip],
    queryFn: () => api.get<CouncilStatisticsResponse>(path),
    enabled: canView,
  });

  if (!canView) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a council secretary or council admin can view council statistics."
      />
    );
  }

  function drillInto(council: CouncilRollupDto) {
    if (data) setTrail(t => [...t, { councilId: data.focus.councilId, councilName: data.focus.councilName }]);
    setFocusCouncilId(council.councilId);
    setSkip(0);
  }

  function jumpToTrail(index: number) {
    const target = trail[index];
    if (!target) return;
    setTrail(t => t.slice(0, index));
    setFocusCouncilId(target.councilId);
    setSkip(0);
  }

  function goHome() {
    setTrail([]);
    setFocusCouncilId(null);
    setSkip(0);
  }

  if (isLoading) return <ScreenSkeleton rows={8} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (!data) return null;

  const f = data.focus;

  return (
    <div style={{ paddingBottom: 28 }}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Council statistics</h1>
        <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 4, lineHeight: 1.5 }}>
          {shortDate(data.fromDate)} – {shortDate(data.toDate)}
        </p>
      </div>

      <div style={{ padding: "6px 16px 0" }}>
        <Breadcrumb trail={trail} current={f.councilName} onHome={goHome} onJump={jumpToTrail} />
      </div>

      <PeriodSelector
        period={period} onChange={p => { setPeriod(p); setSkip(0); }}
        customFrom={customFrom} customTo={customTo}
        onCustomFrom={setCustomFrom} onCustomTo={setCustomTo}
      />

      <GroupLabel>{f.councilName}</GroupLabel>
      <div style={{ padding: "0 16px" }}>
        <SeatingCard rollup={f} />
      </div>

      <GroupLabel>Structure</GroupLabel>
      <div style={{ padding: "0 16px" }}>
        <div style={tilesGridStyle}>
          <Tile label="Child councils" value={f.directChildCouncilCount} />
          <Tile label="Councils in this tree" value={f.totalCouncilsInSubtree} />
          <Tile label="Chapters in this tree" value={f.totalChaptersInSubtree} />
          <Tile label="Active chapters" value={f.activeChapterCount} valueColor="var(--in)" />
        </div>
      </div>

      <GroupLabel>Membership</GroupLabel>
      <MembershipGroup rollup={f} />

      <GroupLabel>Renewal — this period</GroupLabel>
      <RenewalGroup rollup={f} />

      <GroupLabel>Chapter registrations in this tree</GroupLabel>
      <div style={{ padding: "0 16px" }}>
        <div style={tilesGridStyle}>
          <Tile label="Submitted" value={f.regSubmittedCount} />
          <Tile label="Returned for correction" value={f.regReturnedForCorrectionCount} />
          <Tile label="Approved" value={f.regApprovedCount} valueColor="var(--in)" />
        </div>
      </div>

      <GroupLabel>Activity — this period</GroupLabel>
      <ActivityGroup rollup={f} />

      <GroupLabel>Corrective actions across this tree</GroupLabel>
      <CorrectiveActionsGroup counts={data.correctiveActionTotals} />

      {data.childCouncils.length > 0 && (
        <>
          <GroupLabel>Child councils</GroupLabel>
          <div style={{ padding: "0 16px", overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Council</th>
                  <th style={thStyle}>Level</th>
                  <th style={thStyle}>Officers</th>
                  <th style={thStyle}>Members</th>
                  <th style={thStyle}>Chapters</th>
                </tr>
              </thead>
              <tbody>
                {data.childCouncils.map(c => (
                  <tr key={c.councilId}>
                    <td style={tdStyle}>
                      <button type="button" onClick={() => drillInto(c)} style={linkButtonStyle}>{c.councilName}</button>
                    </td>
                    <td style={tdStyle}>{c.levelName}</td>
                    <td style={tdStyle}>
                      {c.hasSeatedOfficers
                        ? <span style={{ color: "var(--in)" }}>Seated</span>
                        : <span style={{ color: "var(--out)" }}>Not seated</span>}
                    </td>
                    <td style={tdStyle} className="num">{c.memberTotal}</td>
                    <td style={tdStyle} className="num">{c.totalChaptersInSubtree}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <GroupLabel>Chapters in this tree</GroupLabel>
      {data.chapters.length === 0 ? (
        <div style={{ padding: "0 16px" }}>
          <p style={{ fontSize: 12, color: "var(--mute)", lineHeight: 1.6 }}>
            No chapters found under this council.
          </p>
        </div>
      ) : (
        <ChaptersTable
          chapters={data.chapters} toDate={data.toDate}
          totalCount={data.totalChapterCount} skip={skip}
          onLoadMore={() => setSkip(s => s + CHAPTERS_TAKE)}
        />
      )}

      <p style={{ padding: "18px 16px 0", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.6 }}>
        Every figure above is a council-wide or chapter-wide total, never a per-member
        number. Chapter balances are aggregate totals only — individual ledger entries
        stay visible to that chapter's own officers and members.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- Breadcrumb */

function Breadcrumb({ trail, current, onHome, onJump }: {
  trail: Crumb[]; current: string; onHome: () => void; onJump: (index: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, fontSize: 12.5 }}>
      <button type="button" onClick={onHome} style={crumbButtonStyle}>Your council</button>
      {trail.map((c, i) => (
        <span key={c.councilId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "var(--mute)" }}>›</span>
          <button type="button" onClick={() => onJump(i)} style={crumbButtonStyle}>{c.councilName}</button>
        </span>
      ))}
      <span style={{ color: "var(--mute)" }}>›</span>
      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{current}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- Seating card */

function SeatingCard({ rollup }: { rollup: CouncilRollupDto }) {
  return (
    <div style={cardStyle}>
      {rollup.hasSeatedOfficers ? (
        <p style={{ fontSize: 13, color: "var(--in)", margin: 0 }}>Officers seated.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--out)", margin: 0, fontWeight: 600 }}>No officers seated.</p>
          <p style={{ fontSize: 12, color: "var(--slate)", marginTop: 4, lineHeight: 1.6 }}>
            Renewals beneath this council cannot be approved until it is reconstituted.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Period selector */

function PeriodSelector({ period, onChange, customFrom, customTo, onCustomFrom, onCustomTo }: {
  period: PeriodOption; onChange: (p: PeriodOption) => void;
  customFrom: string; customTo: string;
  onCustomFrom: (v: string) => void; onCustomTo: (v: string) => void;
}) {
  return (
    <div style={{ padding: "10px 16px 4px" }}>
      <select
        aria-label="Select period" value={period}
        onChange={e => onChange(e.target.value as PeriodOption)}
        style={selectStyle}
      >
        <option value="current">This membership year</option>
        <option value="lastYear">Last membership year</option>
        <option value="last30">Last 30 days</option>
        <option value="custom">Custom range…</option>
      </select>

      {period === "custom" && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            type="date" aria-label="From date" value={customFrom}
            onChange={e => onCustomFrom(e.target.value)} style={dateInputStyle}
          />
          <input
            type="date" aria-label="To date" value={customTo}
            onChange={e => onCustomTo(e.target.value)} style={dateInputStyle}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Membership group */

function MembershipGroup({ rollup: m }: { rollup: CouncilRollupDto }) {
  const byStatus: Record<string, number> = {
    Pending: m.memberPending, Approved: m.memberApproved, Active: m.memberActive,
    Inactive: m.memberInactive, Suspended: m.memberSuspended, Rejected: m.memberRejected,
  };
  const statusColor = (name: string): string | undefined => {
    if (name === "Active") return "var(--in)";
    if (name === "Pending") return "var(--warn)";
    if (name === "Suspended" || name === "Rejected") return "var(--out)";
    return undefined;
  };

  return (
    <div style={{ padding: "0 16px" }}>
      {m.memberTotal === 0 && (
        <p style={{ fontSize: 12, color: "var(--mute)", margin: "0 0 8px", lineHeight: 1.6 }}>
          No members recorded under this council yet.
        </p>
      )}
      <div style={tilesGridStyle}>
        <Tile label="Total members" value={m.memberTotal} />
        {MEMBER_STATUSES.map(s => (
          <Tile key={s.id} label={s.name} value={byStatus[s.name] ?? 0} valueColor={statusColor(s.name)} />
        ))}
        <Tile label="New this period" value={m.newThisPeriod} />
      </div>

      {m.detachedMemberCount > 0 && (
        <p style={{ fontSize: 12, color: "var(--slate)", marginTop: 10, lineHeight: 1.6 }}>
          Plus {m.detachedMemberCount} detached member{m.detachedMemberCount === 1 ? "" : "s"} homed
          directly on this council (their chapter went dormant) — counted here separately,
          never inside any chapter's own numbers.
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- Renewal group */

function RenewalGroup({ rollup: r }: { rollup: CouncilRollupDto }) {
  if (!r.hasRenewalData) {
    return (
      <div style={{ padding: "0 16px" }}>
        <p style={{ fontSize: 13, color: "var(--mute)", lineHeight: 1.6 }}>
          No renewal season recorded yet for this period.
        </p>
      </div>
    );
  }
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={tilesGridStyle}>
        <Tile label="Renewed" value={r.renewedCount} valueColor="var(--in)" />
        <Tile label="Lapsed" value={r.lapsedCount} />
        <Tile label="Exempt" value={r.exemptCount} />
        <Tile label="Not recorded" value={r.notRecordedCount} />
      </div>
      <p style={{ fontSize: 11, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 }}>
        Lapsed is not disciplinary.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- Activity group */

function ActivityGroup({ rollup: a }: { rollup: CouncilRollupDto }) {
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={tilesGridStyle}>
        <Tile label="Meetings held" value={a.meetingsHeld} />
        <div style={{ ...tileStyle, gridColumn: "1 / -1" }}>
          <div style={tileLabelStyle}>Attendance</div>
          {a.meetingsHeld === 0 ? (
            <div style={{ fontSize: 13, color: "var(--mute)", marginTop: 6, lineHeight: 1.6 }}>
              No meetings recorded yet.
            </div>
          ) : (
            <>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, marginTop: 6, color: "var(--ink)" }}>
                Average {a.averagePresentPerMeeting} present per meeting
              </div>
              <div className="num" style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 3 }}>
                {a.totalPresent} present of {a.totalOnSheets} on the sheet, across {a.meetingsHeld} meeting{a.meetingsHeld === 1 ? "" : "s"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Corrective actions group */

function CorrectiveActionsGroup({ counts }: { counts: { statusName: string; caseCount: number }[] }) {
  const byName = new Map(counts.map(c => [c.statusName, c.caseCount]));
  const total = counts.reduce((sum, c) => sum + c.caseCount, 0);
  const statuses = ["Pending", "Under Review", "Reconciled", "Dismissed"];

  const statusColor = (name: string): string | undefined => {
    if (name === "Pending") return "var(--warn)";
    if (name === "Under Review") return "var(--info)";
    return undefined;
  };

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={tilesGridStyle}>
        {statuses.map(s => (
          <Tile key={s} label={s} value={byName.get(s) ?? 0} valueColor={statusColor(s)} />
        ))}
      </div>
      {total === 0 && (
        <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 }}>
          No corrective actions on file across this tree.
        </p>
      )}
      <p style={{ fontSize: 11, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 }}>
        Counts by status only — case narratives stay visible only to the chapter's own
        officers and the member concerned.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- Chapters table */

function ChaptersTable({ chapters, toDate, totalCount, skip, onLoadMore }: {
  chapters: ChapterStatisticsDto[]; toDate: string; totalCount: number; skip: number; onLoadMore: () => void;
}) {
  return (
    <div style={{ padding: "0 16px", overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Chapter</th>
            <th style={thStyle}>Council</th>
            <th style={thStyle}>Members</th>
            <th style={thStyle}>Balance as at {shortDate(toDate)}</th>
            <th style={thStyle}>Cases</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map(c => (
            <tr key={c.chapterId}>
              <td style={tdStyle}>
                <Link
                  to={`/members?chapterId=${c.chapterId}&chapterName=${encodeURIComponent(c.chapterName)}`}
                  style={linkStyle}
                >
                  {c.chapterName}
                </Link>
                {!c.isActive && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--mute)" }}>INACTIVE</span>}
              </td>
              <td style={tdStyle}>{c.parentCouncilName}</td>
              <td style={tdStyle} className="num">{c.memberActive} active / {c.memberTotal} total</td>
              <td style={tdStyle} className="num">
                {c.openingBalance === 0 && c.periodIn === 0 && c.periodOut === 0 && c.closingBalance === 0
                  ? <span style={{ color: "var(--mute)" }}>No entries recorded</span>
                  : peso(c.closingBalance)}
              </td>
              <td style={tdStyle} className="num">
                {c.caseCountPending + c.caseCountUnderReview + c.caseCountReconciled + c.caseCountDismissed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalCount > skip + chapters.length && (
        <div style={{ padding: 16, textAlign: "center" }}>
          <button type="button" onClick={onLoadMore} style={loadMoreStyle}>Load more</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Building blocks */

function GroupLabel({ children }: { children: ReactNode }) {
  return <div style={groupLabelStyle}>{children}</div>;
}

function Tile({ label, value, valueColor }: { label: string; value: ReactNode; valueColor?: string }) {
  return (
    <div style={tileStyle}>
      <div style={tileLabelStyle}>{label}</div>
      <div className="num" style={{ ...tileValueStyle, color: valueColor ?? "var(--ink)" }}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- Date range math */

/**
 * Client-side only convenience for the preset options — NOT a reimplementation of the
 * server's own membership-year rule (Akrho.Domain.MembershipYear is the single source
 * of truth, applied server-side whenever from/to are omitted). Mirrors Dashboard.tsx's
 * identical helper exactly.
 */
function currentMembershipYearOpeningYear(now: Date): number {
  const year = now.getFullYear();
  const cutoff = new Date(year, 7, 9); // 09 Aug, this calendar year
  return now >= cutoff ? year : year - 1;
}

function membershipYearRange(openingYear: number): DateRange {
  return { from: `${openingYear}-08-09`, to: `${openingYear + 1}-08-08` };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last30DaysRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 30);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function rangeFor(period: PeriodOption, customFrom: string, customTo: string): DateRange {
  switch (period) {
    case "lastYear":
      return membershipYearRange(currentMembershipYearOpeningYear(new Date()) - 1);
    case "last30":
      return last30DaysRange();
    case "custom":
      return customFrom && customTo ? { from: customFrom, to: customTo } : {};
    case "current":
    default:
      // Deliberately empty — the server's own default IS "the current membership year".
      return {};
  }
}

/* ------------------------------------------------------------------------- Styles */

const headerStyle: CSSProperties = { padding: "20px 16px 6px" };

const titleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" };

const groupLabelStyle: CSSProperties = {
  padding: "18px 16px 8px", fontFamily: "var(--f-disp)", fontSize: 13,
  letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate)",
};

const selectStyle: CSSProperties = {
  width: "100%", maxWidth: 280, minHeight: "var(--tap)", padding: "0 10px", borderRadius: 8, fontSize: 13.5,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const dateInputStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 10px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const cardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
};

const tilesGridStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 10,
};

const tileStyle: CSSProperties = {
  display: "block", padding: 12, borderRadius: "var(--r)", minHeight: "var(--tap)",
  background: "var(--paper)", border: "1px solid var(--line)",
};

const tileLabelStyle: CSSProperties = {
  fontSize: 11.5, letterSpacing: ".04em", color: "var(--mute)", textTransform: "uppercase",
};

const tileValueStyle: CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 4 };

const crumbButtonStyle: CSSProperties = {
  color: "var(--info)", fontSize: 12.5, minHeight: 28, padding: "0 2px",
};

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)", minWidth: 640,
};

const thStyle: CSSProperties = {
  textAlign: "left", fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};

const linkStyle: CSSProperties = { color: "var(--info)", textDecoration: "none" };

const linkButtonStyle: CSSProperties = { color: "var(--info)", textDecoration: "underline", fontSize: 13.5 };

const loadMoreStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
};
