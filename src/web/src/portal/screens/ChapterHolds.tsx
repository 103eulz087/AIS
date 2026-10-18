import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canManageChapterHolds } from "@/shared/roles";
import { ResponsiveTable } from "../responsive";
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
  const promptRow = promptFor ? rows.find(r => r.chapterId === promptFor.chapterId) : undefined;

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
          <div style={{ marginTop: 16, opacity: isFetching ? 0.6 : 1 }}>
            {promptRow && promptFor && (
              <div style={promptPanelStyle}>
                <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8, overflowWrap: "anywhere" }}>
                  {promptFor.kind === "hold"
                    ? `Placing ${promptRow.chapterName} on hold. Every one of its ${promptRow.memberCount} member(s) will be signed out and unable to log in until released.`
                    : `Releasing ${promptRow.chapterName} from hold. Its members will be able to sign in again.`}
                </p>
                <input
                  value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Reason" style={promptInputStyle} autoFocus
                />
                {actionError && <p role="alert" style={errorStyle}>{actionError}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
              </div>
            )}
            <ResponsiveTable<ChapterJurisdictionResult>
              rows={rows}
              rowKey={r => r.chapterId}
              columns={[
                { key: "chapter", header: "Chapter", primary: true, render: r => r.chapterName },
                {
                  key: "geo", header: "Region / Province / City",
                  cellStyle: { fontSize: 12.5, color: "var(--slate)" },
                  render: r => [r.regionName, r.provinceName, r.cityName].filter(Boolean).join(" / ") || "—",
                },
                { key: "members", header: "Members", render: r => r.memberCount },
                {
                  key: "status", header: "Status",
                  render: r => (
                    <span style={r.isOnHold ? heldBadgeStyle : activeBadgeStyle}>{r.isOnHold ? "On hold" : "Active"}</span>
                  ),
                },
                {
                  key: "act", header: "",
                  render: r => (
                    <button
                      type="button"
                      onClick={() => openPrompt(r.chapterId, r.isOnHold ? "release" : "hold")}
                      style={r.isOnHold ? releaseButtonStyle : holdButtonStyle}
                    >
                      {r.isOnHold ? "Release" : "Place on hold"}
                    </button>
                  ),
                },
              ]}
            />
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

const promptPanelStyle: CSSProperties = {
  padding: 14, marginBottom: 12, borderRadius: "var(--r)", background: "var(--bond)", border: "1px solid var(--line)",
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
