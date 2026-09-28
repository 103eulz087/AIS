import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canManageChapterHolds } from "@/shared/roles";
import type { ChapterJurisdictionResult } from "@/shared/types";

/**
 * Chapter hold settings — freezes (or restores) every login belonging to one chapter at
 * once. A wider version of MemberDirectory's own block/unblock, with the same two-actor
 * authority split as ChapterOfficers' President seat: National Council, OR this
 * chapter's own resolved governing council (usp_Chapter_Hold/_Release, via
 * usp_Approval_ResolveApprover — never a second routing mechanism). Client decision
 * 2026-09-22, made with a documented prior precedent in front of it — see
 * usp_Chapter_Hold.sql's own header for the full reasoning.
 *
 * canManageChapterHolds gates the whole screen; the server re-derives the real
 * per-chapter authority independently, same "coarse client check, real server check"
 * posture as every other Portal screen.
 */
export function ChapterHolds() {
  const { claims } = useAuth();
  const canManage = canManageChapterHolds(claims?.roles ?? []);

  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const ready = canManage && search.length >= 2;

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["chapter-jurisdiction-search", search],
    queryFn: () => api.get<Paged<ChapterJurisdictionResult>>(
      `/api/chapters/search-jurisdiction?search=${encodeURIComponent(search)}&take=50`,
    ),
    enabled: ready,
    retry: false,
  });

  const [promptFor, setPromptFor] = useState<{ chapterId: number; kind: "hold" | "release" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openPrompt(chapterId: number, kind: "hold" | "release") {
    setActionError(null);
    setReason("");
    setPromptFor({ chapterId, kind });
  }

  async function confirmAction() {
    if (!promptFor) return;
    if (!reason.trim()) { setActionError("A reason is required."); return; }

    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/chapters/${promptFor.chapterId}/${promptFor.kind}`, { reason: reason.trim() });
      setPromptFor(null);
      await refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only National Council, or a chapter's own governing council, can place it on hold."
      />
    );
  }

  const rows = data?.items ?? [];

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Chapter holds</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Placing a chapter on hold immediately signs out and blocks the login of every member in it.
        A reason is required and recorded.
      </p>

      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Chapter name…"
        autoFocus
        style={searchInputStyle}
      />

      {search.length > 0 && search.length < 2 && (
        <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>Enter at least 2 characters.</p>
      )}

      {ready && isLoading && <ScreenSkeleton rows={4} />}
      {ready && error && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}

      {ready && !isLoading && !error && (
        rows.length === 0 ? (
          <EmptyState title="No matches" body="No chapter in your jurisdiction matches that search." />
        ) : (
          <div style={{ overflowX: "auto", marginTop: 16, opacity: isFetching ? 0.6 : 1 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Chapter</th>
                  <th style={thStyle}>Region / Province / City</th>
                  <th style={thStyle}>Members</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.chapterId}>
                    <tr>
                      <td style={tdStyle}>{r.chapterName}</td>
                      <td style={{ ...tdStyle, fontSize: 12.5, color: "var(--slate)" }}>
                        {[r.regionName, r.provinceName, r.cityName].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td style={tdStyle}>{r.memberCount}</td>
                      <td style={tdStyle}>
                        <span style={r.isOnHold ? heldBadgeStyle : activeBadgeStyle}>
                          {r.isOnHold ? "On hold" : "Active"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => openPrompt(r.chapterId, r.isOnHold ? "release" : "hold")}
                          style={r.isOnHold ? releaseButtonStyle : holdButtonStyle}
                        >
                          {r.isOnHold ? "Release" : "Place on hold"}
                        </button>
                      </td>
                    </tr>
                    {promptFor?.chapterId === r.chapterId && (
                      <tr>
                        <td colSpan={5} style={{ ...tdStyle, background: "var(--bond)" }}>
                          <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>
                            {promptFor.kind === "hold"
                              ? `Placing ${r.chapterName} on hold. Every one of its ${r.memberCount} member(s) will be signed out and unable to log in until released.`
                              : `Releasing ${r.chapterName} from hold. Its members will be able to sign in again.`}
                          </p>
                          <input
                            value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Reason" style={promptInputStyle} autoFocus
                          />
                          {actionError && <p role="alert" style={errorStyle}>{actionError}</p>}
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                              type="button" onClick={() => { void confirmAction(); }} disabled={busy}
                              style={{ ...holdButtonStyle, background: "var(--deep)", color: "var(--brass-soft)" }}
                            >
                              {busy ? "…" : promptFor.kind === "hold" ? "Confirm hold" : "Confirm release"}
                            </button>
                            <button type="button" onClick={() => setPromptFor(null)} disabled={busy} style={holdButtonStyle}>
                              Cancel
                            </button>
                          </div>
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

const searchInputStyle: CSSProperties = {
  width: "100%", maxWidth: 480, minHeight: "var(--tap)", padding: "0 14px", marginTop: 16,
  borderRadius: 8, fontSize: 15, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)", minWidth: 760,
};

const thStyle: CSSProperties = {
  textAlign: "left", fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};

const heldBadgeStyle: CSSProperties = {
  display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12,
  background: "var(--out)", color: "var(--paper)",
};

const activeBadgeStyle: CSSProperties = {
  display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12,
  background: "var(--brass-soft)", color: "var(--deep)",
};

const holdButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--out)", fontSize: 12.5,
};

const releaseButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 12.5,
};

const promptInputStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 14,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const errorStyle: CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--out)", lineHeight: 1.5 };
