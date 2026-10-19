import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { api } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canViewPaymentReport, canViewPaymentTags } from "@/shared/roles";
import { membershipYearLabel } from "@/shared/format";
import { ResponsiveTable, useIsNarrow } from "../responsive";
import type { MemberPaymentTagStats } from "@/shared/types";
import { csvField, downloadCsv, placeLabel } from "./paymentReportUtils";
import { PaymentMemberList, type PaymentStatus } from "./PaymentMemberList";

/**
 * The Paid/Unpaid/Free report — one row per chapter, counting its active members by
 * payment-tag status for a membership year. GET /api/member-payment-tags/stats?membershipYear=
 * (every chapter nationally). Gated on canViewPaymentReport (MemberPaymentTag.Report); same
 * "coarse client check, real server check" posture as every other Portal screen.
 *
 * Search, region/province/city, status chips, sort and year all live in the URL query string
 * so a filtered view can be bookmarked or shared. These are payment TAGS: nothing here
 * computes or implies an amount owed.
 */

export const FIRST_MEMBERSHIP_YEAR = 2026;

export type ShowFilter = "all" | "unpaid" | "settled" | "untagged";
export type SortKey = "name" | "unpaid" | "pct" | "members";

const SHOW_OPTIONS: { value: ShowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unpaid", label: "Has unpaid members" },
  { value: "settled", label: "Everyone paid or free" },
  { value: "untagged", label: "Nobody tagged yet" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Chapter name (A–Z)" },
  { value: "unpaid", label: "Most unpaid" },
  { value: "pct", label: "Lowest % paid or free" },
  { value: "members", label: "Most members" },
];

export { placeLabel };

export function percentSettled(r: { totalMembers: number; paidCount: number; freeCount: number }): number {
  return r.totalMembers > 0 ? Math.round(((r.paidCount + r.freeCount) / r.totalMembers) * 100) : 0;
}

/** The membership year runs 9 Aug -> 8 Aug and is named by the year it opens. */
export function currentMembershipYear(now = new Date()): number {
  const m = now.getMonth();
  const d = now.getDate();
  const y = now.getFullYear();
  const opened = (m > 7 || (m === 7 && d >= 9)) ? y : y - 1;
  return Math.max(opened, FIRST_MEMBERSHIP_YEAR);
}

export interface ReportFilters {
  q: string; region: string; province: string; city: string; show: ShowFilter; sort: SortKey;
}

export function filterAndSort(rows: readonly MemberPaymentTagStats[], f: ReportFilters): MemberPaymentTagStats[] {
  const q = f.q.trim().toLowerCase();
  const out = rows.filter(r => {
    const region = placeLabel(r.regionName);
    const province = placeLabel(r.provinceName);
    const city = placeLabel(r.cityName);
    if (f.region && region !== f.region) return false;
    if (f.province && province !== f.province) return false;
    if (f.city && city !== f.city) return false;
    if (f.show === "unpaid" && r.unpaidCount === 0) return false;
    if (f.show === "settled" && r.unpaidCount !== 0) return false;
    if (f.show === "untagged" && r.paidCount + r.freeCount !== 0) return false;
    if (q) {
      const hay = [r.chapterName, region, province, city].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const byName = (a: MemberPaymentTagStats, b: MemberPaymentTagStats) => a.chapterName.localeCompare(b.chapterName);
  out.sort((a, b) => {
    switch (f.sort) {
      case "unpaid": return b.unpaidCount - a.unpaidCount || byName(a, b);
      case "pct": return percentSettled(a) - percentSettled(b) || byName(a, b);
      case "members": return b.totalMembers - a.totalMembers || byName(a, b);
      default: return byName(a, b);
    }
  });
  return out;
}

/** The report as CSV text: UTF-8 BOM first so Excel shows Ñ/ñ correctly, CRLF line ends. */
export function buildReportCsv(rows: readonly MemberPaymentTagStats[]): string {
  const lines: string[][] = [
    ["Chapter", "Region", "Province", "City", "Members", "Paid", "Free", "Unpaid", "% paid or free", "Membership year"],
  ];
  for (const r of rows) {
    lines.push([
      r.chapterName, placeLabel(r.regionName) ?? "", placeLabel(r.provinceName) ?? "", placeLabel(r.cityName) ?? "",
      String(r.totalMembers), String(r.paidCount), String(r.freeCount), String(r.unpaidCount),
      `${percentSettled(r)}%`, String(r.membershipYear),
    ]);
  }
  return "﻿" + lines.map(l => l.map(csvField).join(",")).join("\r\n") + "\r\n";
}

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}

export function MemberPaymentTagStats() {
  const { claims } = useAuth();
  const canView = canViewPaymentReport(claims?.councilSeats ?? []);
  const canSeeMembers = canViewPaymentTags(claims?.councilSeats ?? []);
  const [panel, setPanel] = useState<{ status: PaymentStatus | null; chapterIds: number[] | null; title: string } | null>(null);
  const [params, setParams] = useSearchParams();

  const thisYear = currentMembershipYear();
  const yearParam = Number(params.get("year"));
  const year = Number.isInteger(yearParam) && yearParam >= FIRST_MEMBERSHIP_YEAR && yearParam <= thisYear ? yearParam : thisYear;

  const showParam = params.get("show");
  const sortParam = params.get("sort");
  const narrow = useIsNarrow();
  const [filtersOpen, setFiltersOpen] = useState(false);

  function update(changes: Record<string, string>) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === "" || (k === "show" && v === "all") || (k === "sort" && v === "name") || (k === "year" && Number(v) === thisYear)) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }

  // As-you-type search, written to the URL after a short pause.
  const qParam = params.get("q") ?? "";
  const [qInput, setQInput] = useState(qParam);
  useEffect(() => {
    if (qInput === qParam) return;
    const t = setTimeout(() => update({ q: qInput }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);
  useEffect(() => { setQInput(qParam); }, [qParam]);

  const statsQuery = useQuery({
    queryKey: ["member-payment-tag-stats", year],
    queryFn: () => api.get<MemberPaymentTagStats[]>(`/api/member-payment-tags/stats?membershipYear=${year}`),
    enabled: canView,
    retry: false,
  });

  const allRows = useMemo(() => statsQuery.data ?? [], [statsQuery.data]);

  // A place in the URL may be written either way ("Region 10" or "Region 10 Council", any
  // case) — e.g. a link typed or shared by hand. It is matched to a real option; one that
  // matches no chapter is ignored rather than silently emptying the whole report.
  const resolvePlace = (raw: string | null, options: string[]): string => {
    const wanted = placeLabel(raw)?.toLowerCase();
    if (!wanted) return "";
    if (allRows.length === 0) return placeLabel(raw) ?? "";
    return options.find(o => o.toLowerCase() === wanted) ?? "";
  };
  const regions = useMemo(() => uniqueSorted(allRows.map(r => placeLabel(r.regionName))), [allRows]);
  const region = resolvePlace(params.get("region"), regions);
  const provinces = useMemo(() => uniqueSorted(
    allRows.filter(r => !region || placeLabel(r.regionName) === region).map(r => placeLabel(r.provinceName))),
    [allRows, region]);
  const province = resolvePlace(params.get("province"), provinces);
  const cities = useMemo(() => uniqueSorted(
    allRows.filter(r => (!region || placeLabel(r.regionName) === region)
      && (!province || placeLabel(r.provinceName) === province)).map(r => placeLabel(r.cityName))),
    [allRows, region, province]);
  const city = resolvePlace(params.get("city"), cities);

  const filters: ReportFilters = {
    q: qParam, region, province, city,
    show: SHOW_OPTIONS.some(o => o.value === showParam) ? (showParam as ShowFilter) : "all",
    sort: SORT_OPTIONS.some(o => o.value === sortParam) ? (sortParam as SortKey) : "name",
  };

  const rows = useMemo(() => filterAndSort(allRows, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, filters.q, filters.region, filters.province, filters.city, filters.show, filters.sort]);

  if (!canView) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Your office does not have the 'View payment report' permission."
      />
    );
  }

  if (statsQuery.isLoading) return <ScreenSkeleton rows={6} />;
  if (statsQuery.error) {
    return <ErrorState message={(statsQuery.error as Error).message} onRetry={() => statsQuery.refetch()} />;
  }

  const totals = rows.reduce(
    (acc, r) => ({
      totalMembers: acc.totalMembers + r.totalMembers,
      paidCount: acc.paidCount + r.paidCount,
      freeCount: acc.freeCount + r.freeCount,
      unpaidCount: acc.unpaidCount + r.unpaidCount,
    }),
    { totalMembers: 0, paidCount: 0, freeCount: 0, unpaidCount: 0 },
  );

  const anyFilter = !!(filters.q || filters.region || filters.province || filters.city || filters.show !== "all");
  const activeControls = [filters.region, filters.province, filters.city].filter(Boolean).length
    + (filters.sort !== "name" ? 1 : 0) + (year !== thisYear ? 1 : 0);
  const clear = () => { setQInput(""); update({ q: "", region: "", province: "", city: "", show: "all" }); };
  const years: number[] = [];
  for (let y = thisYear; y >= FIRST_MEMBERSHIP_YEAR; y--) years.push(y);

  const scopeTitle = filters.city || filters.province || filters.region || (anyFilter ? "Chapters shown" : "All chapters");
  const openTile = (st: PaymentStatus | null) =>
    setPanel({ status: st, chapterIds: anyFilter ? rows.map(r => r.chapterId) : null, title: scopeTitle });

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>
        Payment report
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        How many members are tagged Paid, Free, or Unpaid for {membershipYearLabel(year)}, per chapter.
      </p>

      <div style={filterGridStyle}>
        <label style={{ ...fieldStyle, gridColumn: "1 / -1" }} data-tour="pay-report-search">
          <span style={labelStyle}>Search</span>
          <input
            type="search"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            placeholder="Chapter, region, province or city…"
            aria-label="Search chapters"
            style={controlStyle}
          />
        </label>
        {/* On a phone the place, year and sort controls fold away so the results start on the
            first screen; the button says how many of them are in use. */}
        {narrow && (
          <button type="button" aria-expanded={filtersOpen} aria-controls="report-filters"
            onClick={() => setFiltersOpen(o => !o)} style={{ ...filtersToggleStyle, gridColumn: "1 / -1" }}
            data-tour="pay-report-filters-toggle">
            {filtersOpen ? "Hide filters" : "Filters & sort"}
            {activeControls > 0 && ` (${activeControls} in use)`}
          </button>
        )}
        {(!narrow || filtersOpen) && <>
        <label style={fieldStyle} data-tour="pay-report-place">
          <span style={labelStyle}>Region</span>
          <select aria-label="Region" style={controlStyle} value={filters.region}
            onChange={e => update({ region: e.target.value, province: "", city: "" })}>
            <option value="">All regions</option>
            {regions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Province</span>
          <select aria-label="Province" style={controlStyle} value={filters.province}
            onChange={e => update({ province: e.target.value, city: "" })}>
            <option value="">All provinces</option>
            {provinces.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>City</span>
          <select aria-label="City" style={controlStyle} value={filters.city}
            onChange={e => update({ city: e.target.value })}>
            <option value="">All cities</option>
            {cities.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label style={fieldStyle} data-tour="pay-report-year">
          <span style={labelStyle}>Membership year</span>
          <select aria-label="Membership year" style={controlStyle} value={year}
            onChange={e => update({ year: e.target.value })}>
            {years.map(y => <option key={y} value={y}>{membershipYearLabel(y)}</option>)}
          </select>
        </label>
        <label style={fieldStyle} data-tour="pay-report-sort">
          <span style={labelStyle}>Sort by</span>
          <select aria-label="Sort by" style={controlStyle} value={filters.sort}
            onChange={e => update({ sort: e.target.value })}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        </>}
      </div>

      <div style={chipRowStyle} role="group" aria-label="Show chapters" data-tour="pay-report-chips">
        {SHOW_OPTIONS.map(o => (
          <button key={o.value} type="button" aria-pressed={filters.show === o.value}
            onClick={() => update({ show: o.value })} style={chipStyle(filters.show === o.value)}>
            {o.label}
          </button>
        ))}
      </div>

      <div style={summaryRowStyle} data-tour="pay-report-tiles">
        <SummaryTile label="Total members" value={String(totals.totalMembers)} color="var(--ink)" onOpen={() => openTile(null)} />
        <SummaryTile label="Paid" value={String(totals.paidCount)} color="var(--in)" onOpen={() => openTile("Paid")} />
        <SummaryTile label="Free" value={String(totals.freeCount)} color="var(--info)" onOpen={() => openTile("Free")} />
        <SummaryTile label="Unpaid" value={String(totals.unpaidCount)} color="var(--out)" onOpen={() => openTile("Unpaid")} />
        <SummaryTile label="% paid or free" value={`${percentSettled(totals)}%`} color="var(--ink)" />
      </div>

      <div style={barStyle}>
        <span style={{ fontSize: 13.5, color: "var(--slate)" }} aria-live="polite">
          Showing {rows.length} of {allRows.length} chapters
        </span>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {anyFilter && <button type="button" onClick={clear} style={buttonStyle}>Clear filters</button>}
          <button type="button" disabled={rows.length === 0} style={buttonStyle} data-tour="pay-report-csv"
            onClick={() => downloadCsv(buildReportCsv(rows), `payment-report-${year}.csv`)}>
            Download CSV
          </button>
        </span>
      </div>

      {allRows.length === 0 ? (
        <EmptyState title="No chapters yet" body="No chapter has any active members on file." />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No chapter matches these filters"
          body="Try a different search, or clear the filters to see every chapter."
          action={<button type="button" onClick={clear} style={buttonStyle}>Clear filters</button>}
        />
      ) : (
        <div style={{ marginTop: 12 }} data-tour="pay-report-table">
          <ResponsiveTable
            rows={rows}
            rowKey={r => r.chapterId}
            onRowClick={r => setPanel({ status: null, chapterIds: [r.chapterId], title: r.chapterName })}
            columns={[
              { key: "chapter", header: "Chapter", primary: true, render: r => {
                const place = [placeLabel(r.cityName), placeLabel(r.provinceName), placeLabel(r.regionName)].filter(Boolean).join(" · ");
                return (
                  <span style={{ overflowWrap: "anywhere" }}>
                    {r.chapterName}
                    {place && <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--mute)", marginTop: 2 }}>{place}</span>}
                  </span>
                );
              } },
              { key: "total", header: "Total", numeric: true, render: r => r.totalMembers },
              { key: "paid", header: "Paid", numeric: true, cellStyle: { color: "var(--in)" }, render: r => <span style={{ color: "var(--in)" }}>{r.paidCount}</span> },
              { key: "free", header: "Free", numeric: true, cellStyle: { color: "var(--info)" }, render: r => <span style={{ color: "var(--info)" }}>{r.freeCount}</span> },
              { key: "unpaid", header: "Unpaid", numeric: true, cellStyle: { color: "var(--out)" }, render: r => <span style={{ color: "var(--out)" }}>{r.unpaidCount}</span> },
              { key: "pct", header: "% Paid/Free", numeric: true, render: r => `${percentSettled(r)}%` },
            ]}
          />
        </div>
      )}
      {panel && (
        <PaymentMemberList
          key={`${panel.title}|${panel.status}|${panel.chapterIds?.join(",") ?? "*"}`}
          title={panel.title} year={year} initialStatus={panel.status} chapterIds={panel.chapterIds}
          canRead={canSeeMembers} onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, color, onOpen }: { label: string; value: string; color: string; onOpen?: () => void }) {
  const body = (
    <>
      <div style={tileLabelStyle}>{label}</div>
      <div className="num" style={{ ...tileValueStyle, color }}>{value}</div>
      {onOpen && <div style={{ fontSize: 12, color: "var(--info)", marginTop: 2 }}>See members ›</div>}
    </>
  );
  if (!onOpen) return <div style={tileStyle}>{body}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={`${label}: ${value}. See members`}
      style={{ ...tileStyle, textAlign: "left", cursor: "pointer", minHeight: "var(--tap)", font: "inherit", color: "inherit" }}>
      {body}
    </button>
  );
}

const summaryRowStyle: CSSProperties = {
  display: "grid", gap: 12, marginTop: 20, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
};

const tileStyle: CSSProperties = {
  minWidth: 0, padding: "14px 16px", borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--line)",
};

const tileLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--mute)",
};

const tileValueStyle: CSSProperties = {
  fontSize: 26, fontWeight: 700, marginTop: 4,
};

const filtersToggleStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--info)", fontSize: 13.5, textAlign: "left",
};

const filterGridStyle: CSSProperties = {
  display: "grid", gap: 12, marginTop: 20, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};
const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const labelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mute)",
};
const controlStyle: CSSProperties = {
  width: "100%", minWidth: 0, minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};
const chipRowStyle: CSSProperties = { display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" };
function chipStyle(active: boolean): CSSProperties {
  return {
    minHeight: "var(--tap)", padding: "0 16px", borderRadius: 999, fontSize: 13,
    border: "1px solid var(--line)", background: active ? "var(--info)" : "var(--paper)",
    color: active ? "var(--paper)" : "var(--slate)",
  };
}
const barStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 20,
};
const buttonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 13.5,
};
