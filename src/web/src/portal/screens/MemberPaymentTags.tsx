import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canManageMemberPaymentTags } from "@/shared/roles";
import type { ChapterJurisdictionResult, MemberPaymentStatus, MemberPaymentTag } from "@/shared/types";

type SearchMode = "chapter" | "member";
type StatusFilter = MemberPaymentStatus | "All";

/**
 * National Council's own payment-tagging module (client decision 2026-09-29) — two ways
 * in (added 2026-10-06): search a chapter (reusing the same chapter jurisdiction search
 * Chapter Holds uses) and see its whole roster, OR search a member directly, nationally,
 * without knowing his chapter first. Either way, tag him Paid, Unpaid, or Free (tri-state,
 * added 2026-10-06) for this membership year — no amount, no receipt, deliberately
 * separate from the existing renewal-fee module, see db/schema/25_member_payment_tag.sql's
 * own header. Free is for members given free membership for the year: it suppresses the
 * Digital ID's "NOT YET PAID" watermark exactly like Paid does, but is tracked as its own
 * distinct state here and in the Paid/Unpaid/Free report (MemberPaymentTagStats.tsx).
 *
 * The status filter (All/Paid/Unpaid/Free) narrows whichever list is showing — a
 * chapter's roster, or direct search results.
 *
 * canManageMemberPaymentTags gates the whole screen; the server re-derives the real
 * "seated National CouncilAdmin" authority independently, same "coarse client check,
 * real server check" posture as every other Portal screen.
 */
export function MemberPaymentTags() {
  const { claims } = useAuth();
  const canManage = canManageMemberPaymentTags(claims?.roles ?? []);

  const [mode, setMode] = useState<SearchMode>("chapter");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const [selectedChapter, setSelected] = useState<{ chapterId: number; chapterName: string } | null>(null);

  // Switching modes clears the other mode's own search/selection state, so stale
  // results from one never bleed into the other.
  function switchMode(next: SearchMode) {
    setMode(next);
    setInput("");
    setSearch("");
    setSelected(null);
  }

  const chapterSearchReady = canManage && mode === "chapter" && selectedChapter === null && search.length >= 2;

  const chapterQuery = useQuery({
    queryKey: ["chapter-jurisdiction-search", search],
    queryFn: () => api.get<Paged<ChapterJurisdictionResult>>(
      `/api/chapters/search-jurisdiction?search=${encodeURIComponent(search)}&take=50`,
    ),
    enabled: chapterSearchReady,
    retry: false,
  });

  const statusQueryParam = statusFilter === "All" ? "" : `&status=${statusFilter}`;

  const chapterMembersQuery = useQuery({
    queryKey: ["member-payment-tags", "chapter", selectedChapter?.chapterId, statusFilter],
    queryFn: () => api.get<MemberPaymentTag[]>(
      `/api/member-payment-tags/members?chapterId=${selectedChapter!.chapterId}${statusQueryParam}`,
    ),
    enabled: canManage && mode === "chapter" && selectedChapter !== null,
    retry: false,
  });

  const memberSearchReady = canManage && mode === "member" && search.length >= 2;
  const memberSearchQuery = useQuery({
    queryKey: ["member-payment-tags", "search", search, statusFilter],
    queryFn: () => api.get<MemberPaymentTag[]>(
      `/api/member-payment-tags/members?search=${encodeURIComponent(search)}${statusQueryParam}`,
    ),
    enabled: memberSearchReady,
    retry: false,
  });

  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [busyMemberId, setBusyMemberId] = useState<number | null>(null);

  async function setStatus(m: MemberPaymentTag, status: MemberPaymentStatus) {
    if (m.paymentStatus === status) return;
    setBusyMemberId(m.memberId);
    setRowError(prev => { const next = { ...prev }; delete next[m.memberId]; return next; });
    try {
      await api.post(`/api/member-payment-tags/members/${m.memberId}`, { status });
      if (mode === "chapter") await chapterMembersQuery.refetch();
      else await memberSearchQuery.refetch();
    } catch (err) {
      setRowError(prev => ({
        ...prev,
        [m.memberId]: err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      }));
    } finally {
      setBusyMemberId(null);
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only National Council can tag members as paid."
      />
    );
  }

  function MemberTable({ rows, membershipYear }: { rows: MemberPaymentTag[]; membershipYear: number | null }) {
    if (rows.length === 0) {
      return <EmptyState title="No members" body="Nobody matches this search and filter." />;
    }
    return (
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Member</th>
              <th style={thStyle}>Member No.</th>
              {mode === "member" && <th style={thStyle}>Chapter</th>}
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Paid {membershipYear}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.memberId}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{m.giftName}</div>
                  <div style={{ fontSize: 12, color: "var(--mute)" }}>{m.fullName}</div>
                </td>
                <td style={tdStyle}>{m.memberNumber}</td>
                {mode === "member" && <td style={tdStyle}>{m.chapterName}</td>}
                <td style={tdStyle}>{m.statusName}</td>
                <td style={tdStyle}>
                  <div style={tagButtonRowStyle}>
                    {(["Paid", "Free", "Unpaid"] as const).map(option => (
                      <button
                        key={option}
                        type="button"
                        disabled={busyMemberId === m.memberId}
                        onClick={() => { void setStatus(m, option); }}
                        style={tagButtonStyle(m.paymentStatus === option, option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  {m.paymentStatus !== "Unpaid" && m.taggedByGiftName && (
                    <div style={{ fontSize: 11, color: "var(--mute)", marginTop: 4 }}>
                      by {m.taggedByGiftName}
                    </div>
                  )}
                  {rowError[m.memberId] && (
                    <p role="alert" style={errorStyle}>{rowError[m.memberId]}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Member payment tags</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Search a chapter, or a member directly, and tag who has paid, is exempt for free,
        or hasn&rsquo;t paid this membership year.
      </p>

      <div style={tabRowStyle}>
        <button type="button" onClick={() => switchMode("chapter")} style={tabStyle(mode === "chapter")}>
          By chapter
        </button>
        <button type="button" onClick={() => switchMode("member")} style={tabStyle(mode === "member")}>
          By member
        </button>
      </div>

      {mode === "chapter" && selectedChapter && (
        <button type="button" onClick={() => setSelected(null)} style={backButtonStyle}>← Back to chapter search</button>
      )}

      {!(mode === "chapter" && selectedChapter) && (
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={mode === "chapter" ? "Chapter name…" : "Member name or number…"}
          autoFocus
          style={searchInputStyle}
        />
      )}

      {mode === "chapter" && selectedChapter && (
        <h2 style={{ fontFamily: "var(--f-disp)", fontSize: 18, letterSpacing: ".02em", marginTop: 12 }}>
          {selectedChapter.chapterName}
        </h2>
      )}

      <div style={statusFilterRowStyle}>
        {(["All", "Paid", "Free", "Unpaid"] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => setStatusFilter(option)}
            style={filterChipStyle(statusFilter === option)}
          >
            {option}
          </button>
        ))}
      </div>

      {input.length > 0 && search.length < 2 && (
        <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>Enter at least 2 characters.</p>
      )}

      {/* Chapter mode: search → pick a chapter → its member list */}
      {mode === "chapter" && !selectedChapter && (
        <>
          {chapterSearchReady && chapterQuery.isLoading && <ScreenSkeleton rows={4} />}
          {chapterSearchReady && chapterQuery.error && (
            <ErrorState message={(chapterQuery.error as Error).message} onRetry={() => chapterQuery.refetch()} />
          )}
          {chapterSearchReady && !chapterQuery.isLoading && !chapterQuery.error && (
            (chapterQuery.data?.items ?? []).length === 0 ? (
              <EmptyState title="No matches" body="No chapter matches that search." />
            ) : (
              <div style={{ overflowX: "auto", marginTop: 16 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Chapter</th>
                      <th style={thStyle}>Region / Province / City</th>
                      <th style={thStyle}>Members</th>
                      <th style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {(chapterQuery.data?.items ?? []).map(r => (
                      <tr key={r.chapterId}>
                        <td style={tdStyle}>{r.chapterName}</td>
                        <td style={{ ...tdStyle, fontSize: 12.5, color: "var(--slate)" }}>
                          {[r.regionName, r.provinceName, r.cityName].filter(Boolean).join(" / ") || "—"}
                        </td>
                        <td style={tdStyle}>{r.memberCount}</td>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            onClick={() => setSelected({ chapterId: r.chapterId, chapterName: r.chapterName })}
                            style={viewButtonStyle}
                          >
                            View members
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      {mode === "chapter" && selectedChapter && (
        <>
          {chapterMembersQuery.isLoading && <ScreenSkeleton rows={4} />}
          {chapterMembersQuery.error && (
            <ErrorState message={(chapterMembersQuery.error as Error).message} onRetry={() => chapterMembersQuery.refetch()} />
          )}
          {!chapterMembersQuery.isLoading && !chapterMembersQuery.error && (
            <MemberTable
              rows={chapterMembersQuery.data ?? []}
              membershipYear={chapterMembersQuery.data?.[0]?.membershipYear ?? null}
            />
          )}
        </>
      )}

      {/* Member mode: direct national search, flat results */}
      {mode === "member" && (
        <>
          {memberSearchReady && memberSearchQuery.isLoading && <ScreenSkeleton rows={4} />}
          {memberSearchReady && memberSearchQuery.error && (
            <ErrorState message={(memberSearchQuery.error as Error).message} onRetry={() => memberSearchQuery.refetch()} />
          )}
          {memberSearchReady && !memberSearchQuery.isLoading && !memberSearchQuery.error && (
            <MemberTable
              rows={memberSearchQuery.data ?? []}
              membershipYear={memberSearchQuery.data?.[0]?.membershipYear ?? null}
            />
          )}
        </>
      )}
    </div>
  );
}

const searchInputStyle: CSSProperties = {
  width: "100%", maxWidth: 480, minHeight: "var(--tap)", padding: "0 14px", marginTop: 16,
  borderRadius: 8, fontSize: 15, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
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
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};

const viewButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 12.5,
};

const backButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 4px", border: "none", background: "none",
  color: "var(--info)", fontSize: 13.5, cursor: "pointer", marginTop: 12, display: "block",
};

const errorStyle: CSSProperties = { marginTop: 4, fontSize: 12.5, color: "var(--out)", lineHeight: 1.4 };

const tabRowStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 16 };

function tabStyle(active: boolean): CSSProperties {
  return {
    minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8,
    border: "1px solid var(--line)", fontSize: 13, fontFamily: "var(--f-disp)", letterSpacing: ".04em",
    background: active ? "var(--deep)" : "var(--paper)", color: active ? "var(--brass-soft)" : "var(--slate)",
  };
}

const statusFilterRowStyle: CSSProperties = { display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" };

function filterChipStyle(active: boolean): CSSProperties {
  return {
    minHeight: 34, padding: "0 12px", borderRadius: 999, fontSize: 12.5,
    border: "1px solid var(--line)", background: active ? "var(--info)" : "var(--paper)",
    color: active ? "var(--paper)" : "var(--slate)",
  };
}

const tagButtonRowStyle: CSSProperties = { display: "flex", gap: 4 };

function tagButtonStyle(active: boolean, option: "Paid" | "Free" | "Unpaid"): CSSProperties {
  const activeColor = option === "Paid" ? "var(--in)" : option === "Free" ? "var(--info)" : "var(--out)";
  return {
    minHeight: 30, padding: "0 10px", borderRadius: 6, fontSize: 11.5, fontWeight: active ? 700 : 400,
    border: `1px solid ${active ? activeColor : "var(--line)"}`,
    background: active ? activeColor : "var(--paper)", color: active ? "var(--paper)" : "var(--slate)",
  };
}
