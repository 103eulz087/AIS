import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { isSameChapter, type DirectoryRow } from "@/shared/types";
import { useState } from "react";

const BLOOD = ["All", "O+", "O−", "A+", "B+", "AB+"];

export function MemberDirectory() {
  const [blood, setBlood] = useState("All");

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["members", blood],
    queryFn: () => api.get<Paged<DirectoryRow>>(
      `/api/members?take=50${blood !== "All" ? `&bloodType=${encodeURIComponent(blood)}` : ""}`),
  });

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (!data?.items.length) {
    return (
      <EmptyState
        title="No brothers match that filter"
        body={blood === "All"
          ? "Once members are approved they appear here, searchable by blood type, skill and profession."
          : `No brother in this chapter is recorded as ${blood}. Try searching other chapters.`}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px" }}>
        {BLOOD.map(b => (
          <button key={b} onClick={() => setBlood(b)} style={{
            flex: "none", padding: "6px 12px", borderRadius: 16, fontSize: 12,
            border: "1px solid var(--line)", minHeight: 34,
            background: blood === b ? "var(--deep)" : "var(--paper)",
            color: blood === b ? "var(--brass-soft)" : "var(--slate)",
          }}>{b}</button>
        ))}
      </div>

      {data.items.map(row => (
        <div key={row.memberId} style={{
          display: "flex", gap: 12, alignItems: "center", padding: 12,
          background: "var(--paper)", borderBottom: "1px solid var(--line)",
          minHeight: "var(--tap)",
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 8, background: "var(--deep)",
            color: "var(--brass-soft)", display: "grid", placeItems: "center",
            fontFamily: "var(--f-disp)", fontSize: 17,
          }}>{row.giftName.slice(0, 2)}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{row.giftName}</div>
            {/* Cross-chapter rows carry chapter and status only — render exactly what arrived. */}
            <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>
              {isSameChapter(row)
                ? [row.fullName, row.profession].filter(Boolean).join(" · ")
                : row.chapterName}
            </div>
          </div>

          {isSameChapter(row) && row.bloodType && (
            <span className="num" style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 4,
              color: "var(--out)", border: "1px solid #E4C4C0", background: "#FBF0EF",
            }}>{row.bloodType}</span>
          )}
        </div>
      ))}
    </div>
  );
}
