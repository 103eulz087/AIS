import { type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { api } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canViewPaymentTags } from "@/shared/roles";
import { ResponsiveTable } from "../responsive";
import type { MemberPaymentTagStats } from "@/shared/types";

/**
 * The Paid/Unpaid/Free report (client decision 2026-10-06) — one row per chapter,
 * counting its active members by current payment-tag status for the membership year.
 * GET /api/member-payment-tags/stats, no chapterId — every chapter nationally. Same
 * MemberPaymentTag.Read gate (canViewPaymentTags) as MemberPaymentTags.tsx itself; same "coarse client check, real
 * server check" posture as every other Portal screen.
 */
export function MemberPaymentTagStats() {
  const { claims } = useAuth();
  const canManage = canViewPaymentTags(claims?.councilSeats ?? []);

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
        body="Your office does not have the 'View payment tags' permission."
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
        <div style={{ marginTop: 20 }}>
          <ResponsiveTable
            rows={rows}
            rowKey={r => r.chapterId}
            columns={[
              { key: "chapter", header: "Chapter", primary: true, render: r => <span style={{ overflowWrap: "anywhere" }}>{r.chapterName}</span> },
              { key: "total", header: "Total", numeric: true, render: r => r.totalMembers },
              { key: "paid", header: "Paid", numeric: true, cellStyle: { color: "var(--in)" }, render: r => <span style={{ color: "var(--in)" }}>{r.paidCount}</span> },
              { key: "free", header: "Free", numeric: true, cellStyle: { color: "var(--info)" }, render: r => <span style={{ color: "var(--info)" }}>{r.freeCount}</span> },
              { key: "unpaid", header: "Unpaid", numeric: true, cellStyle: { color: "var(--out)" }, render: r => <span style={{ color: "var(--out)" }}>{r.unpaidCount}</span> },
              { key: "pct", header: "% Paid/Free", numeric: true,
                render: r => `${r.totalMembers > 0 ? Math.round(((r.paidCount + r.freeCount) / r.totalMembers) * 100) : 0}%` },
            ]}
          />
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
  display: "grid", gap: 12, marginTop: 20, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
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
