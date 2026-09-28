import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canManageMemberAccounts, canSearchMembersByJurisdiction } from "@/shared/roles";
import { shortDate, validThrough } from "@/shared/format";
import type { BlockedMember, MemberJurisdictionResult, MemberPasswordReset } from "@/shared/types";

/**
 * GET /api/members/{memberId} — the "View details" panel behind one row (search or
 * blocked-list). Mirrors MemberProfileDto (MemberDtos.cs) exactly, the SAME shape
 * usp_Member_GetOwnProfile hands a member reading himself — a seated council officer's
 * oversight already carries this much visibility (see usp_Member_SearchByJurisdiction.sql's
 * own header comment). Local to this screen rather than shared/types.ts, same convention
 * Profile.tsx already uses for its own identical own-profile shape.
 */
interface MemberFullDetail {
  memberId: number;
  memberNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  birthdate: string | null;
  dateSurvive: string | null;
  presidentDuringSurvive: string | null;
  masterInitiatorDuringSurvive: string | null;
  chapterId: number | null;
  chapterName: string | null;
  homeCouncilId: number | null;
  councilName: string | null;
  chapterOfRecord: string | null;
  status: string;
  renewedThrough: string | null;
  seconderMemberId: number | null;
  approvedBy: number | null;
  approvedDateUtc: string | null;
  address: string | null;
  mobileNo: string | null;
  email: string | null;
  bloodTypeId: number | null;
  bloodTypeName: string | null;
  bloodTypeConfirmedDateUtc: string | null;
  profession: string | null;
  photoUrl: string | null;
  skillIds: number[];
  rowVersion: string;
  regionName: string | null;
  provinceName: string | null;
  cityName: string | null;
}

type AccountActionKind = "block" | "unblock" | "reset";

/**
 * The Council Portal's ONE member screen — search, view full detail, and (National
 * Council only) block/unblock a login or force a password reset, all from the same
 * place. Consolidated 2026-09-23 from three separate entry points (a search screen, a
 * standalone "blocked members" list, and block/reset actions that used to live only in
 * AIS's own chapter-scoped MemberDirectory) — client decision: one way to navigate
 * member functionality in the Portal, not three.
 *
 * What jurisdiction the SEARCH covers is decided entirely server-side
 * (usp_Member_SearchByJurisdiction, keyed off the caller's own seated council): a
 * National officer's own scope happens to be the whole organization, so the SAME screen
 * and the SAME query serve both "search everyone" (National) and "search only my own
 * region/province/city" (everyone else) with no mode toggle here to get wrong. The
 * "Blocked members" view is its own, separate toggle (National Council only —
 * usp_Member_ListBlocked's own scope) since browsing every currently-blocked account has
 * no search term to type; it isn't a filter on the jurisdiction search.
 *
 * canSearchMembersByJurisdiction / canManageMemberAccounts gate what this screen shows;
 * the server re-derives the real authorization independently inside each procedure,
 * same "coarse client check, real server check" posture as every other Portal screen.
 */
export function MemberSearch() {
  const { claims } = useAuth();
  const canSearch = canSearchMembersByJurisdiction(claims?.roles ?? []);
  const canManageAccounts = canManageMemberAccounts(claims?.roles ?? []);

  const [showBlockedOnly, setShowBlockedOnly] = useState(false);

  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");

  // A short debounce — this can search the entire organization at National, so firing a
  // request on every keystroke is real load, not just noise.
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const searchReady = canSearch && !showBlockedOnly && search.length >= 2;

  const searchQuery = useQuery({
    queryKey: ["member-jurisdiction-search", search],
    queryFn: () => api.get<Paged<MemberJurisdictionResult>>(
      `/api/members/search-jurisdiction?search=${encodeURIComponent(search)}&take=100`,
    ),
    enabled: searchReady,
    retry: false,
  });

  const blockedQuery = useQuery({
    queryKey: ["blocked-members"],
    queryFn: () => api.get<BlockedMember[]>("/api/members/blocked"),
    enabled: canManageAccounts && showBlockedOnly,
    retry: false,
  });

  // "View details" — one row expanded at a time, fetched on demand rather than carried
  // in the row itself (a search or blocked-list row already has everything most lookups
  // need; the full record is a deliberate extra round trip, same restraint as
  // MemberDirectory's own reissue-link/reset-password actions). Works from either mode —
  // the same GET /api/members/{id} endpoint, scoped the same way either time.
  const [viewingId, setViewingId] = useState<number | null>(null);
  const detailQuery = useQuery({
    queryKey: ["member-jurisdiction-detail", viewingId],
    queryFn: () => api.get<MemberFullDetail>(`/api/members/${viewingId}`),
    enabled: viewingId !== null,
    retry: false,
  });

  function toggleDetails(memberId: number) {
    setViewingId(current => (current === memberId ? null : memberId));
  }

  // Block / unblock / reset-password — National Council only, one shared prompt for all
  // three, same reason-required discipline as ChapterHolds' own prompt.
  const [promptFor, setPromptFor] = useState<{ memberId: number; giftName: string; kind: AccountActionKind } | null>(null);
  const [reason, setReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<MemberPasswordReset | null>(null);
  const [resetLinkCopied, setResetLinkCopied] = useState(false);

  function openPrompt(memberId: number, giftName: string, kind: AccountActionKind) {
    setActionError(null);
    setReason("");
    setPromptFor({ memberId, giftName, kind });
  }

  async function confirmAction() {
    if (!promptFor) return;
    if (!reason.trim()) { setActionError("A reason is required."); return; }

    setActionBusy(true);
    setActionError(null);
    try {
      if (promptFor.kind === "reset") {
        const res = await api.post<MemberPasswordReset>(
          `/api/members/${promptFor.memberId}/reset-password`, { reason: reason.trim() },
        );
        setResetResult(res);
        setResetLinkCopied(false);
      } else {
        await api.post(`/api/members/${promptFor.memberId}/${promptFor.kind}`, { reason: reason.trim() });
      }
      setPromptFor(null);
      if (showBlockedOnly) await blockedQuery.refetch();
      else await searchQuery.refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }

  if (!canSearch) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a seated council officer can search members."
      />
    );
  }

  const searchRows = searchQuery.data?.items ?? [];
  const blockedRows = blockedQuery.data ?? [];

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Members</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Search by gift name, legal name, member number, or mobile number — within your own council's jurisdiction.
      </p>

      {canManageAccounts && (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setShowBlockedOnly(false)}
            style={showBlockedOnly ? tabStyle : tabActiveStyle}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setShowBlockedOnly(true)}
            style={showBlockedOnly ? tabActiveStyle : tabStyle}
          >
            Blocked members
          </button>
        </div>
      )}

      {resetResult && (
        <div style={resetPanelStyle}>
          <div style={{ fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".03em", color: "var(--in)" }}>
            Password reset — new link issued
          </div>
          <p style={{ fontSize: 13, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
            His account is locked until he opens this link and sets a new password — copy it now
            and send it to him yourself. This is the only time it will ever be shown.
          </p>
          <div style={resetLinkBoxStyle}>{resetResult.enrolmentUrl}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(resetResult.enrolmentUrl).then(() => setResetLinkCopied(true));
              }}
              style={viewButtonStyle}
            >
              {resetLinkCopied ? "Copied" : "Copy link"}
            </button>
            <button type="button" onClick={() => setResetResult(null)} style={viewButtonStyle}>Dismiss</button>
          </div>
        </div>
      )}

      {!showBlockedOnly && (
        <>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Name, member number, or mobile number…"
            autoFocus
            style={searchInputStyle}
          />

          {search.length > 0 && search.length < 2 && (
            <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>Enter at least 2 characters.</p>
          )}

          {searchReady && searchQuery.isLoading && <ScreenSkeleton rows={5} />}
          {searchReady && searchQuery.error && <ErrorState message={(searchQuery.error as Error).message} />}

          {searchReady && !searchQuery.isLoading && !searchQuery.error && (
            searchRows.length === 0 ? (
              <EmptyState title="No matches" body="Nobody in your jurisdiction matches that search." />
            ) : (
              <div style={{ overflowX: "auto", marginTop: 16, opacity: searchQuery.isFetching ? 0.6 : 1 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Member</th>
                      <th style={thStyle}>Chapter / Home council</th>
                      <th style={thStyle}>Region / Province / City</th>
                      <th style={thStyle}>Mobile</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Renewal</th>
                      <th style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {searchRows.map(r => (
                      <Fragment key={r.memberId}>
                        <tr>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>{r.giftName} — {r.memberNumber}</div>
                            <div style={{ fontSize: 12, color: "var(--slate)" }}>{r.fullName}</div>
                          </td>
                          <td style={tdStyle}>
                            {r.chapterName ?? (r.homeCouncilName ? `${r.homeCouncilName} (detached)` : "—")}
                          </td>
                          <td style={{ ...tdStyle, fontSize: 12.5, color: "var(--slate)" }}>
                            {[r.regionName, r.provinceName, r.cityName].filter(Boolean).join(" / ") || "—"}
                          </td>
                          <td style={tdStyle}>{r.mobileNo ?? "—"}</td>
                          <td style={tdStyle}>
                            <span style={statusBadgeStyle(r.statusName)}>{r.statusName}</span>
                            {r.isBlocked && <span style={blockedBadgeStyle}>Blocked</span>}
                          </td>
                          <td style={tdStyle}>{validThrough(r.renewedThrough)}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button type="button" onClick={() => toggleDetails(r.memberId)} style={viewButtonStyle}>
                                {viewingId === r.memberId ? "Hide" : "View details"}
                              </button>
                              {canManageAccounts && (
                                <>
                                  {r.isBlocked ? (
                                    <button
                                      type="button"
                                      onClick={() => openPrompt(r.memberId, r.giftName, "unblock")}
                                      style={unblockButtonStyle}
                                    >
                                      Unblock
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openPrompt(r.memberId, r.giftName, "block")}
                                      style={blockButtonStyle}
                                    >
                                      Block
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openPrompt(r.memberId, r.giftName, "reset")}
                                    style={viewButtonStyle}
                                  >
                                    Reset password
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {viewingId === r.memberId && (
                          <tr>
                            <td colSpan={7} style={{ ...tdStyle, background: "var(--bond)" }}>
                              <DetailPanel query={detailQuery} />
                            </td>
                          </tr>
                        )}
                        {promptFor?.memberId === r.memberId && (
                          <tr>
                            <td colSpan={7} style={{ ...tdStyle, background: "var(--bond)" }}>
                              <AccountActionPrompt
                                promptFor={promptFor} reason={reason} setReason={setReason}
                                busy={actionBusy} error={actionError}
                                onConfirm={() => { void confirmAction(); }}
                                onCancel={() => setPromptFor(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      {showBlockedOnly && (
        blockedQuery.isLoading ? <ScreenSkeleton rows={5} /> :
        blockedQuery.error ? <ErrorState message={(blockedQuery.error as Error).message} onRetry={() => blockedQuery.refetch()} /> :
        blockedRows.length === 0 ? (
          <EmptyState title="Nobody is currently blocked" body="Blocked members appear here for review." />
        ) : (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Member</th>
                  <th style={thStyle}>Chapter</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Blocked</th>
                  <th style={thStyle}>By</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {blockedRows.map(r => (
                  <Fragment key={r.memberId}>
                    <tr>
                      <td style={tdStyle} className="num">{r.giftName} — {r.memberNumber}</td>
                      <td style={tdStyle}>{r.chapterName ?? "—"}</td>
                      <td style={tdStyle}>{r.reason}</td>
                      <td style={tdStyle}>{shortDate(r.performedDateUtc)}</td>
                      <td style={tdStyle}>{r.blockedByGiftName ?? "—"}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => toggleDetails(r.memberId)} style={viewButtonStyle}>
                            {viewingId === r.memberId ? "Hide" : "View details"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openPrompt(r.memberId, r.giftName, "unblock")}
                            style={unblockButtonStyle}
                          >
                            Unblock
                          </button>
                        </div>
                      </td>
                    </tr>
                    {viewingId === r.memberId && (
                      <tr>
                        <td colSpan={6} style={{ ...tdStyle, background: "var(--bond)" }}>
                          <DetailPanel query={detailQuery} />
                        </td>
                      </tr>
                    )}
                    {promptFor?.memberId === r.memberId && (
                      <tr>
                        <td colSpan={6} style={{ ...tdStyle, background: "var(--bond)" }}>
                          <AccountActionPrompt
                            promptFor={promptFor} reason={reason} setReason={setReason}
                            busy={actionBusy} error={actionError}
                            onConfirm={() => { void confirmAction(); }}
                            onCancel={() => setPromptFor(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function DetailPanel({ query }: { query: ReturnType<typeof useQuery<MemberFullDetail>> }) {
  if (query.isLoading) return <p style={{ fontSize: 13, color: "var(--slate)" }}>Loading…</p>;
  if (query.error) {
    return (
      <p role="alert" style={errorStyle}>
        {query.error instanceof ApiError ? query.error.message : "Could not load this member's details."}
      </p>
    );
  }
  if (!query.data) return null;
  return <MemberDetailFields d={query.data} />;
}

function AccountActionPrompt({
  promptFor, reason, setReason, busy, error, onConfirm, onCancel,
}: {
  promptFor: { memberId: number; giftName: string; kind: AccountActionKind };
  reason: string; setReason: (v: string) => void;
  busy: boolean; error: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  const copy = {
    block: `Blocking ${promptFor.giftName}'s login. A reason is required and recorded.`,
    unblock: `Unblocking ${promptFor.giftName}. A reason is required and recorded.`,
    reset: `Resetting ${promptFor.giftName}'s password. His account is locked until he redeems the new link. A reason is required and recorded.`,
  }[promptFor.kind];
  const confirmLabel = { block: "Confirm block", unblock: "Confirm unblock", reset: "Confirm reset" }[promptFor.kind];

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>{copy}</p>
      <input
        value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Reason" style={promptInputStyle} autoFocus
      />
      {error && <p role="alert" style={errorStyle}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button" onClick={onConfirm} disabled={busy}
          style={{ ...viewButtonStyle, background: "var(--deep)", color: "var(--brass-soft)" }}
        >
          {busy ? "…" : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={viewButtonStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MemberDetailFields({ d }: { d: MemberFullDetail }) {
  const rows: [string, string][] = [
    ["Legal name", [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ")],
    ["Region", d.regionName ?? "—"],
    ["Province", d.provinceName ?? "—"],
    ["City / Municipality", d.cityName ?? "—"],
    ["Birthdate", d.birthdate ? shortDate(d.birthdate) : "—"],
    ["Date survive", d.dateSurvive ? shortDate(d.dateSurvive) : "—"],
    ["President during survive", d.presidentDuringSurvive ?? "—"],
    ["Master initiator", d.masterInitiatorDuringSurvive ?? "—"],
    ["Address", d.address ?? "—"],
    ["Email", d.email ?? "—"],
    ["Blood type", d.bloodTypeName ?? "—"],
    ["Profession", d.profession ?? "—"],
    ["Chapter of record", d.chapterOfRecord ?? "—"],
    ["Home council", d.councilName ?? "—"],
    ["Approved", d.approvedDateUtc ? shortDate(d.approvedDateUtc) : "—"],
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px 20px" }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--mute)" }}>
            {label}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 2 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function statusBadgeStyle(statusName: string): CSSProperties {
  const isGood = statusName === "Approved" || statusName === "Active";
  return {
    display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12,
    background: isGood ? "var(--brass-soft)" : "var(--bond)",
    color: isGood ? "var(--deep)" : "var(--slate)",
  };
}

const blockedBadgeStyle: CSSProperties = {
  display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12,
  background: "var(--out)", color: "var(--paper)", marginLeft: 6,
};

const searchInputStyle: CSSProperties = {
  width: "100%", maxWidth: 480, minHeight: "var(--tap)", padding: "0 14px", marginTop: 16,
  borderRadius: 8, fontSize: 15, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)", minWidth: 880,
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

const blockButtonStyle: CSSProperties = { ...viewButtonStyle, color: "var(--out)" };
const unblockButtonStyle: CSSProperties = { ...viewButtonStyle, color: "var(--info)" };

const promptInputStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 14,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const errorStyle: CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--out)", lineHeight: 1.5 };

const tabStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 16px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--slate)",
};

const tabActiveStyle: CSSProperties = {
  ...tabStyle, background: "var(--deep)", color: "var(--brass-soft)", borderColor: "var(--deep)",
};

const resetPanelStyle: CSSProperties = {
  margin: "16px 0 0", padding: 16, borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--brass)",
};

const resetLinkBoxStyle: CSSProperties = {
  marginTop: 10, padding: 10, borderRadius: 8, background: "var(--bond)",
  border: "1px solid var(--line)", fontSize: 12.5, wordBreak: "break-all", color: "var(--ink)",
};
