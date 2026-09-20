import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { peso, pesoSigned, shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import type { LedgerEntry } from "@/shared/types";
import { FundsTabs } from "./FundsTabs";

export function Ledger({ chapterId }: { chapterId: number }) {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["ledger", chapterId],
    queryFn: () => api.get<Paged<LedgerEntry>>(`/api/chapters/${chapterId}/ledger?take=100`),
  });

  if (isLoading) return <ScreenSkeleton rows={7} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (!data?.items.length) {
    return (
      <div>
        <FundsTabs active="ledger" />
        <EmptyState
          title="No postings yet"
          body="Meeting collections, donations and expenses appear here as they are recorded." />
      </div>
    );
  }

  const cashIn = data.items.filter(e => e.entryType === "In").reduce((s, e) => s + e.amount, 0);
  const cashOut = data.items.filter(e => e.entryType === "Out").reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <FundsTabs active="ledger" />

      <div style={{ margin: 16, padding: 14, borderRadius: "var(--r)", background: "var(--deep)",
                    color: "var(--brass-soft)" }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".14em",
                      color: "var(--brass)" }}>CURRENT BALANCE</div>
        <div className="num" style={{ fontSize: 26, fontWeight: 600, color: "#fff", marginTop: 5 }}>
          {peso(cashIn - cashOut)}
        </div>
      </div>

      {/* docs/AIS-Project-Documentation.md §3/§10 Decision #7, amended 2026-09-20 — see
          Dashboard.tsx's identical notice for why this exists. */}
      <p style={{ margin: "0 16px 16px", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.6 }}>
        Your council can see this chapter's overall balance and totals for a period.
        They cannot see individual entries.
      </p>

      {data.items.map(e => (
        // Every posting links to the record behind it. A figure nobody can open
        // is not transparency.
        <div key={e.ledgerEntryId} style={{
          display: "flex", gap: 12, alignItems: "center", padding: "12px 16px",
          background: "var(--paper)", borderBottom: "1px solid var(--line)",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {e.description}
              {e.isReversal && (
                <span style={{ marginLeft: 6, fontSize: 10, color: "var(--warn)" }}>REVERSAL</span>
              )}
            </div>
            <div className="num" style={{ fontSize: 10.5, color: "var(--mute)", marginTop: 3 }}>
              {shortDate(e.entryDate)} · {e.sourceType}
              {e.activityName ? ` · ${e.activityName}` : ""}
            </div>
          </div>
          <div className={`num ${e.entryType === "In" ? "in" : "out"}`}
               style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap" }}>
            {pesoSigned(e.amount, e.entryType)}
          </div>
        </div>
      ))}

      <p style={{ padding: "14px 16px", fontSize: 11.5, color: "var(--mute)", lineHeight: 1.6 }}>
        This ledger is append-only. Nothing here can be edited or deleted — a mistake is
        corrected by a reversing entry, which stays visible beside the original.
      </p>
    </div>
  );
}
