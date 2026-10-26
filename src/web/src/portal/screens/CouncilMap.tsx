import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { ErrorState } from "@/shared/states";
import { ResponsiveTable, useIsNarrow } from "../responsive";
import {
  EMPTY_TOTALS, NEUTRAL, aggregate, boxString, buildClasses, classIndex, loadMapShapes, parseViewBox,
  plural, regionOnlyTotals, unplacedTotals, zoomBox,
  type Box, type MapResponse, type MapShape, type MapView, type Measure, type Totals,
} from "./councilMapLogic";

/**
 * "Where your members are" — a choropleth of the Philippines on Council Statistics.
 *
 * Endpoints:
 *   GET /api/councils/statistics/map                    — the caller's own seat
 *   GET /api/councils/{councilId}/statistics/map        — when the screen is drilled into a council
 *   GET /maps/ph-regions.json, /maps/ph-provinces.json  — static shapes, fetched only when this
 *                                                         section renders
 * Counts only, never names of members (invariant #7). Empty state: "No chapters in your area yet".
 */

const MEASURES: { id: Measure; label: string; noun: string }[] = [
  { id: "members", label: "Members", noun: "members" },
  { id: "appUsers", label: "App users", noun: "app users" },
  { id: "chapters", label: "Chapters", noun: "chapters" },
];

type Zoom = "auto" | "whole" | { region: string };

export function CouncilMap({ focusCouncilId }: { focusCouncilId: number | null }) {
  const narrow = useIsNarrow();
  const [view, setView] = useState<MapView>("regions");
  const [measure, setMeasure] = useState<Measure>("members");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("auto");
  const [asList, setAsList] = useState(false);

  const dataPath = focusCouncilId
    ? `/api/councils/${focusCouncilId}/statistics/map`
    : "/api/councils/statistics/map";
  const dataQ = useQuery({
    queryKey: ["council-statistics-map", focusCouncilId],
    queryFn: () => api.get<MapResponse>(dataPath),
  });
  const shapesQ = useQuery({
    queryKey: ["map-shapes", view],
    queryFn: () => loadMapShapes(view),
    staleTime: Infinity,
  });

  const places = dataQ.data?.places ?? [];
  const shapes: MapShape[] = shapesQ.data?.shapes ?? [];
  const full = parseViewBox(shapesQ.data?.viewBox);

  const totals = useMemo(() => aggregate(places, shapes, view), [places, shapes, view]);
  const valueOf = (key: string) => totals.get(key)?.[measure] ?? 0;
  const max = shapes.reduce((m, s) => Math.max(m, valueOf(s.key)), 0);
  const classes = buildClasses(max);

  const unplaced = unplacedTotals(places);
  const regionOnly = regionOnlyTotals(places);
  const anyData = places.some(p => p.members > 0 || p.chapters > 0);

  const box: Box = useMemo(() => {
    if (zoom === "whole") return full;
    if (typeof zoom === "object") {
      return zoomBox(shapes.filter(s => s.regionCode === zoom.region), full, true) ?? full;
    }
    const withData = shapes.filter(s => { const t = totals.get(s.key); return !!t && (t.members > 0 || t.chapters > 0); });
    // Start zoomed only for a jurisdiction inside ONE region (a regional, provincial or city
    // council). Data spread over several regions — National — always opens on the whole country.
    if (new Set(withData.map(s => s.regionCode)).size !== 1) return full;
    return zoomBox(withData, full, true) ?? full;
  }, [zoom, shapes, totals, full.w, full.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const isZoomed = box.w < full.w - 0.5;

  const shown = hovered ?? selected;
  const shownShape = shapes.find(s => s.key === shown) ?? null;

  if (dataQ.error || shapesQ.error) {
    return (
      <Section>
        <ErrorState
          message={((dataQ.error ?? shapesQ.error) as Error).message}
          onRetry={() => { void dataQ.refetch(); void shapesQ.refetch(); }}
        />
      </Section>
    );
  }
  if (dataQ.isLoading || (shapesQ.isLoading && anyData)) {
    return (
      <Section>
        <div aria-busy="true" aria-label="Loading the map"
          style={{ height: 220, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)", opacity: 0.6 }} />
      </Section>
    );
  }
  if (!anyData && unplaced.chapters === 0) {
    return (
      <Section>
        <p style={mutedText}>No chapters in your area yet.</p>
      </Section>
    );
  }

  const top3 = shapes
    .map(s => ({ s, v: valueOf(s.key) }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  const measureInfo = MEASURES.find(m => m.id === measure)!;
  const drawOrder = [...shapes].sort((a, b) => Number(a.key === shown) - Number(b.key === shown));
  const fontSize = 11 * (box.w / (narrow ? 340 : 560));

  const rows = shapes
    .map(s => ({ s, t: totals.get(s.key) ?? EMPTY_TOTALS }))
    .filter(r => r.t.members > 0 || r.t.chapters > 0 || r.t.appUsers > 0)
    .sort((a, b) => b.t[measure] - a.t[measure] || a.s.name.localeCompare(b.s.name));

  function pick(key: string) { setSelected(cur => (cur === key ? null : key)); }
  function changeView(v: MapView) { setView(v); setSelected(null); setHovered(null); setZoom("auto"); }

  function zoomInto(s: MapShape) {
    setView("provinces"); setSelected(null); setHovered(null);
    setZoom({ region: s.regionCode });
  }

  const details = shownShape && (
    <Details
      shape={shownShape} totals={totals.get(shownShape.key) ?? EMPTY_TOTALS}
      canZoom={view === "regions"} onZoom={() => zoomInto(shownShape)}
      onClear={shown === selected && selected ? () => setSelected(null) : undefined}
    />
  );

  return (
    <Section>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
        <Segmented label="View" value={view} onChange={changeView}
          options={[{ id: "regions", label: "Regions" }, { id: "provinces", label: "Provinces" }]} />
        <Segmented label="Show" value={measure} onChange={setMeasure}
          options={MEASURES.map(m => ({ id: m.id, label: m.label }))} />
      </div>
      <p style={{ ...mutedText, fontSize: 11.5, margin: "0 0 10px" }}>
        App users are members who have set up their sign-in account.
      </p>

      <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: narrow ? "100%" : 560, maxWidth: "100%", flex: "0 1 auto", minWidth: 0 }}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: 8 }}>
            <svg
              viewBox={boxString(box)} role="group" aria-label={`Map of the Philippines by ${measureInfo.noun}`}
              style={{ display: "block", width: "100%", height: "auto", maxHeight: narrow ? "65vh" : undefined }}
              onMouseLeave={() => setHovered(null)}
            >
              {drawOrder.map(s => {
                const v = valueOf(s.key);
                const ci = classIndex(v, classes);
                const active = s.key === shown;
                return (
                  <path
                    key={s.key} d={s.d} tabIndex={0} role="button" data-key={s.key}
                    aria-label={`${s.name}: ${v.toLocaleString("en-PH")} ${measureInfo.noun}`}
                    aria-pressed={s.key === selected}
                    vectorEffect="non-scaling-stroke"
                    onClick={() => pick(s.key)}
                    onMouseEnter={() => setHovered(s.key)}
                    onMouseLeave={() => setHovered(null)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(s.key); } }}
                    style={{
                      cursor: "pointer", outline: "none",
                      fill: ci < 0 ? NEUTRAL : (classes[ci]?.color ?? NEUTRAL),
                      stroke: active ? "var(--ink)" : "#FFFFFF",
                      strokeWidth: active ? 1.5 : 0.75,
                    }}
                  />
                );
              })}
              {top3.map(({ s, v }) => (
                <text
                  key={s.key} x={s.cx} y={s.cy} textAnchor="middle" pointerEvents="none"
                  style={{
                    fontSize, fill: "var(--ink)", stroke: "#FFFFFF", strokeWidth: fontSize * 0.28,
                    paintOrder: "stroke", fontFamily: "var(--f-mono)",
                  }}
                >
                  {v.toLocaleString("en-PH")}
                </text>
              ))}
            </svg>
          </div>
          <p style={{ ...mutedText, fontSize: 10.5, margin: "6px 0 0" }}>{shapesQ.data?.attribution ?? ""}</p>
        </div>

        <div style={{ flex: "1 1 220px", minWidth: 0, width: narrow ? "100%" : undefined }}>
          <Legend title={measureInfo.label} classes={classes} />
          {isZoomed && (
            <button type="button" style={{ ...buttonStyle, marginTop: 10 }} onClick={() => setZoom("whole")}>
              Whole country
            </button>
          )}
          <div style={{ marginTop: 12 }}>
            {details ?? (
              <p style={{ ...mutedText, fontSize: 12.5 }}>
                {narrow ? "Tap" : "Hover over or click"} a place to see its numbers.
              </p>
            )}
          </div>
        </div>
      </div>

      {unplaced.chapters > 0 && (
        <p style={{ ...mutedText, marginTop: 10 }}>
          {plural(unplaced.members, "member")} in {plural(unplaced.chapters, "chapter")} {unplaced.chapters === 1 ? "has" : "have"} no
          place on record, so {unplaced.members === 1 ? "is" : "are"} not on the map.
        </p>
      )}
      {view === "provinces" && regionOnly.chapters > 0 && (
        <p style={{ ...mutedText, marginTop: 6 }}>
          {plural(regionOnly.members, "member")} in {plural(regionOnly.chapters, "chapter")} {regionOnly.chapters === 1 ? "has" : "have"} a
          region but no province on record, so {regionOnly.members === 1 ? "shows" : "show"} only in the Regions view.
        </p>
      )}

      <div style={{ marginTop: 10 }}>
        <button type="button" style={buttonStyle} aria-pressed={asList} onClick={() => setAsList(v => !v)}>
          {asList ? "Hide the list" : "Show as a list"}
        </button>
      </div>

      {asList && (
        <div style={{ marginTop: 10 }}>
          <ResponsiveTable
            rows={rows}
            rowKey={r => r.s.key}
            onRowClick={r => setSelected(r.s.key)}
            emptyText="Nothing to list yet."
            columns={[
              { key: "place", header: "Place", primary: true,
                render: r => <span style={{ fontWeight: r.s.key === selected ? 700 : 400 }}>{r.s.key === selected ? "▸ " : ""}{r.s.name}</span> },
              { key: "members", header: "Members", numeric: true, render: r => r.t.members.toLocaleString("en-PH") },
              { key: "appUsers", header: "App users", numeric: true, render: r => r.t.appUsers.toLocaleString("en-PH") },
              { key: "chapters", header: "Chapters", numeric: true, render: r => r.t.chapters.toLocaleString("en-PH") },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ pieces */

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Where your members are">
      <div style={{
        padding: "18px 0 8px", fontFamily: "var(--f-disp)", fontSize: 13,
        letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate)",
      }}>Where your members are</div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--mute)", minWidth: 36 }}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", background: "var(--paper)" }}>
        {options.map(o => (
          <button
            key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}
            style={{
              minHeight: "var(--tap)", padding: "0 14px", fontSize: 13.5,
              background: o.id === value ? "var(--deep)" : "transparent",
              color: o.id === value ? "var(--paper)" : "var(--ink)",
            }}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function Legend({ title, classes }: { title: string; classes: { label: string; color: string }[] }) {
  return (
    <div aria-label={`Legend: ${title}`}>
      <div style={{ fontSize: 12, color: "var(--slate)", marginBottom: 6 }}>{title} per place</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
        <LegendItem color={NEUTRAL} label="None" />
        {classes.map(c => <LegendItem key={c.label} color={c.color} label={c.label} />)}
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink)" }}>
      <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 3, background: color, border: "1px solid var(--line)" }} />
      <span className="num">{label}</span>
    </span>
  );
}

function Details({ shape, totals, canZoom, onZoom, onClear }: {
  shape: MapShape; totals: Totals; canZoom: boolean; onZoom: () => void; onClear?: () => void;
}) {
  return (
    <div role="status" style={{ padding: 12, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", overflowWrap: "anywhere" }}>{shape.name}</div>
        {onClear && (
          <button type="button" aria-label="Clear selection" onClick={onClear}
            style={{ minWidth: "var(--tap)", minHeight: "var(--tap)", margin: "-10px -8px 0 0", color: "var(--slate)", fontSize: 16 }}>✕</button>
        )}
      </div>
      <dl style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 13 }}>
        <dt style={{ color: "var(--mute)" }}>Members</dt>
        <dd className="num" style={ddStyle}>{totals.members.toLocaleString("en-PH")}</dd>
        <dt style={{ color: "var(--mute)" }}>App users</dt>
        <dd className="num" style={ddStyle}>{totals.appUsers.toLocaleString("en-PH")}</dd>
        <dt style={{ color: "var(--mute)" }}>Chapters</dt>
        <dd className="num" style={ddStyle}>{totals.activeChapters} active of {totals.chapters}</dd>
      </dl>
      {canZoom && (
        <button type="button" onClick={onZoom} style={{ ...buttonStyle, marginTop: 8 }}>Zoom into this region</button>
      )}
    </div>
  );
}

const mutedText: CSSProperties = { fontSize: 12.5, color: "var(--mute)", lineHeight: 1.6, margin: 0 };
const ddStyle: CSSProperties = { margin: 0, color: "var(--ink)", textAlign: "right" };
const buttonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8, fontSize: 13.5,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};
