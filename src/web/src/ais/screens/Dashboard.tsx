import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { peso, shortDate } from "@/shared/format";
import { ErrorState, ScreenSkeleton } from "@/shared/states";
import {
  CORRECTIVE_ACTION_STATUSES, MEMBER_STATUSES,
  type DashboardActivity, type DashboardFinancial, type DashboardMembership,
  type DashboardSummary, type CorrectiveActionStatusCount,
} from "@/shared/types";

type PeriodOption = "current" | "lastYear" | "last30" | "custom";

interface DateRange { from?: string; to?: string }

/**
 * Chapter dashboard — a read-only, date-ranged overview of the WHOLE chapter, open to
 * every member (not officer-only). A SEPARATE screen from Home: Home is "what needs my
 * attention right now"; this is "how is my chapter doing over a period".
 *
 * Endpoint: GET /api/chapters/{chapterId}/dashboard?from=&to= — both params optional;
 * omitting either lets the server default to the current membership year (09 Aug -> 08
 * Aug), which is why "This membership year" never sends explicit from/to itself — the
 * server's own default IS that option, so there is exactly one place that decides what
 * "this year" means.
 *
 * CLAUDE.md invariant #5 (contributions are voluntary) is the highest-risk rule on this
 * screen specifically: every figure below is a chapter-wide total or a headcount, never
 * a per-member number, never a collection/arrears figure, never a donor or attendance
 * leaderboard. averagePresentPerMeeting is the one sanctioned participation-style number
 * in the whole app and is never rendered without the raw headcounts (totalPresent/
 * totalOnSheets) beside it, and never as a bare percentage.
 *
 * openingBalance/periodIn/periodOut/closingBalance describe the SELECTED PERIOD only;
 * currentBalance is the real, all-time chapter balance (same figure as /ledger),
 * computed independently of the period and always labelled separately.
 *
 * Empty state: there is no single top-level empty state — a brand-new chapter still has
 * SOME content (its own zero membership/financial figures), so each group renders its
 * own plain "nothing here yet" copy internally when its own numbers are all zero,
 * matching the tone already used on MeetingList/CaseList, and a zero-count corrective
 * action status is still shown as a tile, never hidden.
 */
export function Dashboard({ chapterId }: { chapterId: number }) {
  const [period, setPeriod] = useState<PeriodOption>("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = rangeFor(period, customFrom, customTo);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["dashboard", chapterId, range.from ?? null, range.to ?? null],
    queryFn: () => api.get<DashboardSummary>(`/api/chapters/${chapterId}/dashboard${buildQuery(range)}`),
  });

  if (isLoading) return <ScreenSkeleton rows={8} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  // Defensive only — react-query never settles isLoading=false/error=false without data.
  if (!data) return null;

  return (
    <div style={{ paddingBottom: 28 }}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Chapter dashboard</h1>
        <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 4, lineHeight: 1.5 }}>
          {shortDate(data.fromDate)} – {shortDate(data.toDate)} · open to every member
        </p>
      </div>

      <PeriodSelector
        period={period} onChange={setPeriod}
        customFrom={customFrom} customTo={customTo}
        onCustomFrom={setCustomFrom} onCustomTo={setCustomTo}
      />

      <GroupLabel>Funds</GroupLabel>
      <FinancialGroup financial={data.financial} />

      <GroupLabel>Membership</GroupLabel>
      <MembershipGroup membership={data.membership} />

      <GroupLabel>Activity</GroupLabel>
      <ActivityGroup activity={data.activity} />

      <GroupLabel>Corrective actions</GroupLabel>
      <CorrectiveActionsGroup counts={data.correctiveActionCounts} />

      <p style={{ padding: "18px 16px 0", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.6 }}>
        Every figure above is a chapter-wide total, never a per-member number. Tap any
        tile to see the real entries behind it.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- Period selector */

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

/* ------------------------------------------------------------------ Funds group */

function FinancialGroup({ financial: f }: { financial: DashboardFinancial }) {
  const noPeriodActivity = f.periodIn === 0 && f.periodOut === 0;

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={cardStyle}>
        <div style={cardTitleStyle}>This period</div>
        <FundRow label="Opening balance" value={f.openingBalance} />
        <FundRow label="Period in" value={f.periodIn} color="var(--in)" signed="in" />
        <FundRow label="Period out" value={f.periodOut} color="var(--out)" signed="out" />
        <FundRow label="Closing balance" value={f.closingBalance} bold />

        {noPeriodActivity ? (
          <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 10, lineHeight: 1.6 }}>
            No fund activity recorded in this period yet.
          </p>
        ) : (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--slate)", lineHeight: 1.7 }}>
            <div>In — meetings {peso(f.inFromMeetings)} · donations {peso(f.inFromDonations)} · other {peso(f.inOther)}</div>
            <div>Out — expenses {peso(f.outOnExpenses)} · other {peso(f.outOther)}</div>
          </div>
        )}
      </div>

      <Link to="/ledger" style={darkCardStyle}>
        <div style={darkCardLabelStyle}>CURRENT CHAPTER FUNDS</div>
        <div className="num" style={darkCardValueStyle}>{peso(f.currentBalance)}</div>
        <div style={darkCardSubStyle}>The real balance today — tap to see every entry behind it</div>
      </Link>
    </div>
  );
}

function FundRow({ label, value, color, bold, signed }: {
  label: string; value: number; color?: string; bold?: boolean; signed?: "in" | "out";
}) {
  const prefix = signed === "in" ? "+" : signed === "out" ? "−" : "";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
      <span style={{ fontSize: 13, color: "var(--slate)" }}>{label}</span>
      <span className="num" style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: color ?? "var(--ink)" }}>
        {prefix}{peso(value)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- Membership group */

function MembershipGroup({ membership: m }: { membership: DashboardMembership }) {
  const byStatus: Record<string, number> = {
    Pending: m.pending, Approved: m.approved, Active: m.active,
    Inactive: m.inactive, Suspended: m.suspended, Rejected: m.rejected,
  };
  const statusColor = (name: string): string | undefined => {
    if (name === "Active") return "var(--in)";
    if (name === "Pending") return "var(--warn)";
    if (name === "Suspended" || name === "Rejected") return "var(--out)";
    return undefined;
  };

  return (
    <div style={{ padding: "0 16px" }}>
      {m.total === 0 && (
        <p style={{ fontSize: 12, color: "var(--mute)", margin: "0 0 8px", lineHeight: 1.6 }}>
          No members recorded in this chapter yet.
        </p>
      )}
      <div style={tilesGridStyle}>
        <Tile to="/members" label="Total members" value={m.total} testId="tile-members-total" />
        {MEMBER_STATUSES.map(s => (
          <Tile
            key={s.id}
            to={`/members?statusId=${s.id}`}
            label={s.name}
            value={byStatus[s.name] ?? 0}
            valueColor={statusColor(s.name)}
            testId={`tile-members-status-${s.id}`}
          />
        ))}
        <Tile label="New this period" value={m.newThisPeriod} testId="tile-members-new" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Activity group */

function ActivityGroup({ activity: a }: { activity: DashboardActivity }) {
  const pct = a.totalOnSheets > 0 ? Math.round((a.totalPresent / a.totalOnSheets) * 100) : null;

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={tilesGridStyle}>
        <Tile to="/meetings" label="Meetings held" value={a.meetingsHeld} testId="tile-meetings-held" />

        <Link to="/meetings" style={{ ...tileStyle, gridColumn: "1 / -1" }} data-testid="tile-attendance">
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
                {pct !== null && <span style={{ color: "var(--mute)", fontSize: 11 }}> ({pct}% of sheets marked present)</span>}
              </div>
            </>
          )}
        </Link>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Corrective actions group */

function CorrectiveActionsGroup({ counts }: { counts: CorrectiveActionStatusCount[] }) {
  const byName = new Map(counts.map(c => [c.statusName, c.caseCount]));
  const total = counts.reduce((sum, c) => sum + c.caseCount, 0);

  const statusColor = (name: string): string | undefined => {
    if (name === "Pending") return "var(--warn)";
    if (name === "Under Review") return "var(--info)";
    return undefined;
  };

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={tilesGridStyle}>
        {CORRECTIVE_ACTION_STATUSES.map(s => (
          <Tile
            key={s}
            to="/corrective-actions"
            label={s}
            value={byName.get(s) ?? 0}
            valueColor={statusColor(s)}
            testId={`tile-corrective-${s.replace(/\s+/g, "-").toLowerCase()}`}
          />
        ))}
      </div>
      {total === 0 && (
        <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 }}>
          No corrective actions on file.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Building blocks */

function GroupLabel({ children }: { children: ReactNode }) {
  return <div style={groupLabelStyle}>{children}</div>;
}

function Tile({ to, label, value, valueColor, testId }: {
  to?: string; label: string; value: ReactNode; valueColor?: string; testId?: string;
}) {
  const content = (
    <>
      <div style={tileLabelStyle}>{label}</div>
      <div className="num" style={{ ...tileValueStyle, color: valueColor ?? "var(--ink)" }}>{value}</div>
    </>
  );
  if (to) {
    return <Link to={to} style={tileStyle} data-testid={testId}>{content}</Link>;
  }
  return <div style={tileStyle} data-testid={testId}>{content}</div>;
}

/* ------------------------------------------------------------------- Date range math */

/**
 * Client-side only, used to build the "Last membership year"/"Last 30 days" presets —
 * NOT a re-implementation of the server's own membership-year rule (Akrho.Domain.
 * MembershipYear is the single source of truth for that, applied server-side whenever
 * from/to are omitted). This is just a convenience for populating explicit from/to
 * query params when the member picks something other than the default.
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

function buildQuery(range: DateRange): string {
  const qs = new URLSearchParams();
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/* ------------------------------------------------------------------------- Styles */

const headerStyle: CSSProperties = { padding: "20px 16px 6px" };

const titleStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em",
};

const groupLabelStyle: CSSProperties = {
  padding: "18px 16px 8px", fontFamily: "var(--f-disp)", fontSize: 13,
  letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate)",
};

const selectStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 10px", borderRadius: 8, fontSize: 13.5,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const dateInputStyle: CSSProperties = {
  flex: 1, minHeight: "var(--tap)", padding: "0 10px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const cardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", marginTop: 10,
};

const cardTitleStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--slate)", marginBottom: 6,
};

const darkCardStyle: CSSProperties = {
  display: "block", marginTop: 10, marginBottom: 4, padding: 14, borderRadius: "var(--r)",
  background: "var(--deep)", color: "var(--brass-soft)", textDecoration: "none",
};

const darkCardLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".14em", color: "var(--brass)",
};

const darkCardValueStyle: CSSProperties = { fontSize: 26, fontWeight: 600, color: "#fff", marginTop: 5 };

const darkCardSubStyle: CSSProperties = { fontSize: 11.5, color: "#8B95A3", marginTop: 4 };

const tilesGridStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 10,
};

const tileStyle: CSSProperties = {
  display: "block", padding: 12, borderRadius: "var(--r)", minHeight: "var(--tap)",
  background: "var(--paper)", border: "1px solid var(--line)", textDecoration: "none",
};

const tileLabelStyle: CSSProperties = {
  fontSize: 11.5, letterSpacing: ".04em", color: "var(--mute)", textTransform: "uppercase",
};

const tileValueStyle: CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 4 };
