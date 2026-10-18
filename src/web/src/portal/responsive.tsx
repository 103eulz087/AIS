import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Phone fit for the Council Portal (2026-10-18). Many municipal councils have no office
 * computer, so every Portal screen must read well on a cheap Android phone held upright.
 *
 * NARROW_QUERY is the one breakpoint Portal screens switch layout at — the same 900px
 * PortalShell uses for its sidebar/drawer, so a screen never shows a desktop table beside
 * a phone menu or the other way round.
 */
export const NARROW_QUERY = "(max-width: 899px)";

/** True on a phone-width screen. jsdom (tests, smoke harness) has no matchMedia: false. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(NARROW_QUERY).matches
      : false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return narrow;
}

export interface ResponsiveColumn<T> {
  /** Stable key for React. */
  key: string;
  /** Column heading on desktop; the small label above the value on a phone card. */
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-aligned on desktop (counts, money, dates). */
  numeric?: boolean;
  /** The card's title on a phone (shown large, no label). Usually the name column. */
  primary?: boolean;
  /** Left out of the phone card (e.g. a detail already in the title). */
  hideOnPhone?: boolean;
  /** Extra style for this column's desktop cells. */
  cellStyle?: CSSProperties;
}

/**
 * A table on desktop, a stack of cards on a phone — the same rows and the same cell
 * renderers either way, so a screen never maintains two copies of its row content.
 * onRowClick makes the whole row/card a tap target (44px+), for list → detail screens.
 */
export function ResponsiveTable<T>({ columns, rows, rowKey, onRowClick, expandedRow, footer, emptyText }: {
  columns: ResponsiveColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** A panel opened under one row (details, a confirm prompt): a full-width row under it on
   * desktop, the bottom of its card on a phone. Return null when that row has nothing open. */
  expandedRow?: (row: T) => ReactNode;
  /** Extra content after the rows (e.g. a totals row) — rendered as a full-width block on a phone. */
  footer?: ReactNode;
  emptyText?: string;
}) {
  const narrow = useIsNarrow();

  if (rows.length === 0 && emptyText) {
    return <p style={{ fontSize: 13, color: "var(--mute)", padding: "12px 0" }}>{emptyText}</p>;
  }

  if (narrow) {
    const primary = columns.find(c => c.primary);
    const rest = columns.filter(c => !c.primary && !c.hideOnPhone);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(row => {
          const body = (
            <>
              {primary && <div style={cardTitleStyle}>{primary.render(row)}</div>}
              <dl style={cardListStyle}>
                {rest.map(c => (
                  <div key={c.key} style={cardFieldStyle}>
                    <dt style={cardLabelStyle}>{c.header}</dt>
                    <dd style={cardValueStyle}>{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
              {expandedRow?.(row)}
            </>
          );
          return onRowClick ? (
            <button key={rowKey(row)} type="button" onClick={() => onRowClick(row)} style={{ ...cardStyle, ...cardButtonStyle }}>
              {body}
            </button>
          ) : (
            <div key={rowKey(row)} style={cardStyle}>{body}</div>
          );
        })}
        {footer && <div style={cardStyle}>{footer}</div>}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ ...thStyle, textAlign: c.numeric ? "right" : "left" }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const expanded = expandedRow?.(row);
            return (
              <Fragment key={rowKey(row)}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map(c => (
                    <td key={c.key} style={{ ...tdStyle, textAlign: c.numeric ? "right" : "left", ...c.cellStyle }}
                      className={c.numeric ? "num" : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {expanded != null && expanded !== false && (
                  <tr><td colSpan={columns.length} style={{ ...tdStyle, background: "var(--bond)" }}>{expanded}</td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)",
};

const thStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const tdStyle: CSSProperties = { padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)" };

const cardStyle: CSSProperties = {
  padding: "12px 14px", borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", minWidth: 0,
};

const cardButtonStyle: CSSProperties = { width: "100%", textAlign: "left", minHeight: "var(--tap)", color: "inherit", font: "inherit" };

const cardTitleStyle: CSSProperties = { fontSize: 15, fontWeight: 600, color: "var(--ink)", marginBottom: 6, overflowWrap: "anywhere" };

const cardListStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px 14px", margin: 0,
};

const cardFieldStyle: CSSProperties = { minWidth: 0 };

const cardLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mute)",
};

const cardValueStyle: CSSProperties = { margin: "2px 0 0", fontSize: 13.5, overflowWrap: "anywhere" };
