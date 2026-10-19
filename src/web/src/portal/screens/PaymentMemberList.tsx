import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/shared/api";
import { isoDateManila, mediumDate, membershipYearLabel } from "@/shared/format";
import { ResponsiveTable, useIsNarrow } from "../responsive";
import { csvField, downloadCsv, placeLabel } from "./paymentReportUtils";

/**
 * The members behind a number on the Payment report. GET /api/member-payment-tags/report-members
 * (needs MemberPaymentTag.Read). Payment TAGS only: dates and who recorded them, never an
 * amount, never "owes".
 */

export type PaymentStatus = "Paid" | "Free" | "Unpaid";

export interface PaymentReportMember {
  memberId: number;
  memberNumber: string;
  giftName: string | null;
  fullName: string;
  chapterId: number;
  chapterName: string;
  regionName: string | null;
  provinceName: string | null;
  cityName: string | null;
  paymentStatus: PaymentStatus;
  taggedDateUtc: string | null;
  taggedByGiftName: string | null;
  membershipYear: number;
}

interface Page { items: PaymentReportMember[]; total: number }

const PAGE = 50;
const CSV_PAGE = 500;
const STATUS_CHIPS: { value: PaymentStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "Paid", label: "Paid" },
  { value: "Free", label: "Free" },
  { value: "Unpaid", label: "Unpaid" },
];

function buildUrl(o: { year: number; status: PaymentStatus | null; chapterIds: number[] | null; search: string; skip: number; take: number }) {
  const p = new URLSearchParams();
  p.set("membershipYear", String(o.year));
  if (o.status) p.set("status", o.status);
  if (o.chapterIds) p.set("chapterIds", o.chapterIds.join(","));
  if (o.search.trim()) p.set("search", o.search.trim());
  p.set("skip", String(o.skip));
  p.set("take", String(o.take));
  return `/api/member-payment-tags/report-members?${p.toString().replace(/%2C/g, ",")}`;
}

export function buildMembersCsv(rows: readonly PaymentReportMember[]): string {
  const lines: string[][] = [[
    "Gift name", "Full name", "Member number", "Chapter", "Region", "Province", "City",
    "Status", "Date paid or free", "Recorded by", "Membership year",
  ]];
  for (const m of rows) {
    lines.push([
      m.giftName ?? "", m.fullName, m.memberNumber, m.chapterName,
      placeLabel(m.regionName) ?? "", placeLabel(m.provinceName) ?? "", placeLabel(m.cityName) ?? "",
      m.paymentStatus, isoDateManila(m.taggedDateUtc), m.taggedByGiftName ?? "", String(m.membershipYear),
    ]);
  }
  return "﻿" + lines.map(l => l.map(csvField).join(",")).join("\r\n") + "\r\n";
}

function dateLine(m: PaymentReportMember): string {
  if (m.paymentStatus === "Unpaid" || !m.taggedDateUtc) return "—";
  return `${m.paymentStatus === "Paid" ? "Paid on" : "Free since"} ${mediumDate(m.taggedDateUtc)}`;
}

export function PaymentMemberList({ title, year, initialStatus, chapterIds, canRead, onClose }: {
  /** Place part of the title, e.g. "Region 10" or "All chapters". */
  title: string;
  year: number;
  initialStatus: PaymentStatus | null;
  /** null = every chapter. */
  chapterIds: number[] | null;
  canRead: boolean;
  onClose: () => void;
}) {
  const narrow = useIsNarrow();
  const [filterStatus, setFilterStatus] = useState<PaymentStatus | null>(initialStatus);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PaymentReportMember[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const reqId = useRef(0);
  const idsKey = chapterIds ? chapterIds.join(",") : "*";

  // Focus in, restore on close, lock page scroll, ESC closes, Tab stays inside.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input, [href], select, [tabindex]:not([tabindex='-1'])"));
      if (f.length === 0) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const load = useCallback(async (skip: number) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<Page>(buildUrl({ year, status: filterStatus, chapterIds, search, skip, take: PAGE }));
      if (id !== reqId.current) return;
      setItems(prev => (skip === 0 ? page.items : [...prev, ...page.items]));
      setTotal(page.total);
    } catch (e) {
      if (id !== reqId.current) return;
      setError((e as Error).message || "Check your connection and try again.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, filterStatus, idsKey, search]);

  useEffect(() => {
    if (!canRead) return;
    setItems([]);
    setTotal(null);
    void load(0);
  }, [canRead, load]);

  async function downloadAll() {
    setCsvBusy(true);
    setCsvError(null);
    try {
      const all: PaymentReportMember[] = [];
      let count = Infinity;
      while (all.length < count) {
        const page = await api.get<Page>(buildUrl({ year, status: filterStatus, chapterIds, search, skip: all.length, take: CSV_PAGE }));
        count = page.total;
        if (page.items.length === 0) break;
        all.push(...page.items);
      }
      downloadCsv(buildMembersCsv(all), `payment-members-${year}${filterStatus ? `-${filterStatus.toLowerCase()}` : ""}.csv`);
    } catch (e) {
      setCsvError((e as Error).message || "The file could not be made. Try again.");
    } finally {
      setCsvBusy(false);
    }
  }

  const heading = `${filterStatus ? `${filterStatus} members` : "All members"} · ${title} · ${membershipYearLabel(year)}`;

  return (
    <div style={backdropStyle} onClick={onClose} data-testid="member-list-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="member-list-title"
        onClick={e => e.stopPropagation()}
        style={narrow ? sheetStyle : drawerStyle}>
        <div style={headerStyle}>
          <div style={{ minWidth: 0 }}>
            <h2 id="member-list-title" style={{ fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".03em", overflowWrap: "anywhere" }}>
              {heading}
            </h2>
            <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 2 }} aria-live="polite">
              {canRead && total !== null ? `${total} ${total === 1 ? "member" : "members"}` : " "}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" style={closeStyle}>✕</button>
        </div>

        {!canRead ? (
          <p style={{ padding: 20, fontSize: 14, lineHeight: 1.6, color: "var(--slate)" }}>
            Seeing the members behind these numbers needs the 'View payment tags' permission. Ask the National President.
          </p>
        ) : (
          <div style={bodyStyle}>
            <div role="group" aria-label="Payment status" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUS_CHIPS.map(c => (
                <button key={c.label} type="button" aria-pressed={filterStatus === c.value}
                  onClick={() => setFilterStatus(c.value)} style={chipStyle(filterStatus === c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
            <input type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Name, gift name or member number…" aria-label="Search members" style={inputStyle} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={downloadAll} disabled={csvBusy || !total} style={buttonStyle}>
                {csvBusy ? "Preparing…" : "Download CSV"}
              </button>
              {csvError && <span role="alert" style={{ fontSize: 13, color: "var(--out)" }}>{csvError}</span>}
            </div>

            {error ? (
              <div role="alert" style={{ textAlign: "center", padding: "20px 8px" }}>
                <p style={{ fontFamily: "var(--f-disp)", fontSize: 18, color: "var(--out)" }}>That did not load</p>
                <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 6 }}>{error}</p>
                <button type="button" onClick={() => void load(items.length)} style={{ ...buttonStyle, marginTop: 12 }}>Try again</button>
              </div>
            ) : loading && items.length === 0 ? (
              <div aria-busy="true" aria-label="Loading">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ height: 56, marginBottom: 8, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)", opacity: 0.6 }} />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p style={{ textAlign: "center", padding: "28px 8px", fontSize: 14, color: "var(--mute)" }}>
                {search.trim() || filterStatus ? "No members match this." : "No members to show here yet."}
              </p>
            ) : (
              <>
                <ResponsiveTable
                  rows={items}
                  rowKey={m => m.memberId}
                  columns={[
                    { key: "member", header: "Member", primary: true, render: m => (
                      <span style={{ overflowWrap: "anywhere" }}>
                        {m.giftName || m.fullName}
                        <span style={subStyle}>
                          {m.giftName ? `${m.fullName} · ` : ""}<span className="num">{m.memberNumber}</span>
                        </span>
                      </span>
                    ) },
                    { key: "chapter", header: "Chapter", render: m => {
                      const place = [placeLabel(m.cityName), placeLabel(m.provinceName), placeLabel(m.regionName)].filter(Boolean).join(" · ");
                      return <span>{m.chapterName}{place && <span style={subStyle}>{place}</span>}</span>;
                    } },
                    { key: "status", header: "Status", render: m => (
                      <span style={badgeStyle(m.paymentStatus)}>{m.paymentStatus}</span>
                    ) },
                    { key: "date", header: "Date paid", render: m => (
                      <span>
                        {dateLine(m)}
                        {m.paymentStatus !== "Unpaid" && m.taggedByGiftName && <span style={subStyle}>by {m.taggedByGiftName}</span>}
                      </span>
                    ) },
                  ]}
                />
                {total !== null && items.length < total && (
                  <button type="button" onClick={() => void load(items.length)} disabled={loading}
                    style={{ ...buttonStyle, alignSelf: "center" }}>
                    {loading ? "Loading…" : `Show more (${total - items.length} left)`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const subStyle: CSSProperties = { display: "block", fontSize: 12, fontWeight: 400, color: "var(--mute)", marginTop: 2 };
const backdropStyle: CSSProperties = { position: "fixed", inset: 0, background: "rgba(14,17,22,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" };
const drawerStyle: CSSProperties = {
  width: "min(760px, 92vw)", height: "100%", background: "var(--bond)", display: "flex", flexDirection: "column",
  boxShadow: "-8px 0 24px rgba(0,0,0,.18)",
};
const sheetStyle: CSSProperties = { width: "100%", height: "100%", background: "var(--bond)", display: "flex", flexDirection: "column" };
const headerStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
  padding: "14px 16px", background: "var(--paper)", borderBottom: "1px solid var(--line)",
};
const closeStyle: CSSProperties = {
  minWidth: "var(--tap)", minHeight: "var(--tap)", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--ink)", fontSize: 16, flexShrink: 0,
};
const bodyStyle: CSSProperties = { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const inputStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};
const buttonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 13.5,
};
function chipStyle(active: boolean): CSSProperties {
  return {
    minHeight: "var(--tap)", padding: "0 16px", borderRadius: 999, fontSize: 13,
    border: "1px solid var(--line)", background: active ? "var(--info)" : "var(--paper)",
    color: active ? "var(--paper)" : "var(--slate)",
  };
}
function badgeStyle(s: PaymentStatus): CSSProperties {
  const c = s === "Paid" ? "var(--in)" : s === "Free" ? "var(--info)" : "var(--out)";
  return { display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, color: c, border: `1px solid ${c}` };
}
