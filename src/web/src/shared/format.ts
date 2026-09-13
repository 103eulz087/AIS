/**
 * All currency, date and identifier formatting lives here.
 * Never format inline — a stray toFixed(1) in one component is how a
 * transparency system starts showing two different balances.
 */

const PHP = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₱38,420.00 — always two decimals, always. */
export function peso(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `₱${PHP.format(n)}`;
}

/** Signed, for ledger rows: +₱3,400.00 / −₱1,250.00 */
export function pesoSigned(amount: number, type: "In" | "Out"): string {
  return `${type === "In" ? "+" : "−"}${peso(amount)}`;
}

const MANILA = "Asia/Manila";

/** Timestamps are stored UTC and rendered in Manila time. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: MANILA, day: "2-digit", month: "short", year: "numeric",
  });
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-PH", {
    timeZone: MANILA, hour: "numeric", minute: "2-digit",
  });
}

/** The membership year runs 09 Aug → 08 Aug and is named by the year it opens. */
export function membershipYearLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, "0")}`;
}

export function validThrough(renewedThrough: string | null | undefined): string {
  return renewedThrough ? `Valid through ${shortDate(renewedThrough)}` : "Not currently renewed";
}
