import { type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { api } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canManageMemberPaymentTags } from "@/shared/roles";
import type { MemberPaymentTagStats } from "@/shared/types";

/**
 * The Paid/Unpaid/Free report (client decision 2026-10-06) — one row per chapter,
 * counting its active members by current payment-tag status for the membership year.
 * GET /api/member-payment-tags/stats, no chapterId — every chapter nationally. Same
 * National-only gate as MemberPaymentTags.tsx itself; same "coarse client check, real
 * server check" posture as every other Portal screen.
 */
export function MemberPaymentTagStats() {
  const { claims } = useAuth();
  const canManage = canManageMemberPaymentTags(claims?.roles ?? []);

  const statsQuery = useQuery({
    queryKey: ["member-payment-tag-stats"],
    queryFn: () => api.get<MemberPaymentTagStats[]>("/api/member-payment-tags/stats"),
    enabled: canManage,
    retry: false,
  });

  if (!canManage) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only National Council can view the payment tag report."
      />
    );
  }

  if (statsQuery.isLoading) return <ScreenSkeleton rows={6} />;
  if (statsQuery.error) {
    return <ErrorState message={(statsQuery.error as Error).message} onRetry={() => statsQuery.refetch()} />;
  }

  const rows = statsQuery.data ?? [];
  const membershipYear = rows[0]?.membershipYear ?? null;

  const totals = rows.reduce(
    (acc, r) => ({
      totalMembers: acc.totalMembers + r.totalMembers,
      paidCount: acc.paidCount + r.paidCount,
      freeCount: acc.freeCount + r.freeCount,
      unpaidCount: acc.unpaidCount + r.unpaidCount,
    }),
    { totalMembers: 0, paidCount: 0, freeCount: 0, unpaidCount: 0 },
  );

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>
        Payment tag report
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        How many members are tagged Paid, Free, or Unpaid for {membershipYear ?? "this membership year"},
        per chapter.
      </p>

      <div style={summaryRowStyle}>
        <SummaryTile label="Total members" value={totals.totalMembers} color="var(--ink)" />
        <SummaryTile label="Paid" value={totals.paidCount} color="var(--in)" />
        <SummaryTile label="Free" value={totals.freeCount} color="var(--info)" />
        <SummaryTile label="Unpaid" value={totals.unpaidCount} color="var(--out)" />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No chapters yet" body="No chapter has any active members on file." />
      ) : (
        <div style={{ overflowX: "auto", marginTop: 20 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Chapter</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                <th style={{ ...thStyle, textAlign: "right", color: "var(--in)" }}>Paid</th>
                <th style={{ ...thStyle, textAlign: "right", color: "var(--info)" }}>Free</th>
                <th style={{ ...thStyle, textAlign: "right", color: "var(--out)" }}>Unpaid</th>
                <th style={{ ...thStyle, textAlign: "right" }}>% Paid/Free</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const covered = r.paidCount + r.freeCount;
                const pct = r.totalMembers > 0 ? Math.round((covered / r.totalMembers) * 100) : 0;
                return (
                  <tr key={r.chapterId}>
                    <td style={tdStyle}>{r.chapterName}</td>
                    <td className="num" style={{ ...tdStyle, textAlign: "right" }}>{r.totalMembers}</td>
                    <td className="num" style={{ ...tdStyle, textAlign: "right", color: "var(--in)" }}>{r.paidCount}</td>
                    <td className="num" style={{ ...tdStyle, textAlign: "right", color: "var(--info)" }}>{r.freeCount}</td>
                    <td className="num" style={{ ...tdStyle, textAlign: "right", color: "var(--out)" }}>{r.unpaidCount}</td>
                    <td className="num" style={{ ...tdStyle, textAlign: "right" }}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={tileStyle}>
      <div style={tileLabelStyle}>{label}</div>
      <div className="num" style={{ ...tileValueStyle, color }}>{value}</div>
    </div>
  );
}

const summaryRowStyle: CSSProperties = {
  display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap",
};

const tileStyle: CSSProperties = {
  flex: "1 1 120px", padding: "14px 16px", borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--line)",
};

const tileLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
  color: "var(--mute)",
};

const tileValueStyle: CSSProperties = {
  fontSize: 26, fontWeight: 700, marginTop: 4,
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
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)",
};
