import { Fragment, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canManageMemberAccounts } from "@/shared/roles";
import type { BlockedMember } from "@/shared/types";

/**
 * National Council's own review of currently-blocked member accounts, with the means to
 * unblock. Without this screen, usp_Member_Block would be a write-only action nobody
 * could ever reverse from the UI — see GET /api/members/blocked's own doc comment.
 *
 * canManageMemberAccounts gates the whole screen; the server re-derives the real
 * National-Council-only authorization independently inside usp_Member_ListBlocked/
 * _Unblock, same "coarse client check, real server check" posture as CouncilStatistics.
 */
export function BlockedMembers() {
  const { claims } = useAuth();
  const canManage = canManageMemberAccounts(claims?.roles ?? []);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["blocked-members"],
    queryFn: () => api.get<BlockedMember[]>("/api/members/blocked"),
    enabled: canManage,
    retry: false,
  });

  const [promptId, setPromptId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openPrompt(memberId: number) {
    setActionError(null);
    setReason("");
    setPromptId(memberId);
  }

  async function confirmUnblock() {
    if (promptId === null) return;
    if (!reason.trim()) { setActionError("A reason is required."); return; }

    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/members/${promptId}/unblock`, { reason: reason.trim() });
      setPromptId(null);
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
        body="Only National Council can view or manage blocked accounts."
      />
    );
  }

  if (isLoading) return <ScreenSkeleton rows={5} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const rows = data ?? [];

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Blocked members</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Members whose login is currently blocked, and why.
      </p>

      {rows.length === 0 ? (
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
              {rows.map(r => (
                <Fragment key={r.memberId}>
                  <tr>
                    <td style={tdStyle} className="num">{r.giftName} — {r.memberNumber}</td>
                    <td style={tdStyle}>{r.chapterName ?? "—"}</td>
                    <td style={tdStyle}>{r.reason}</td>
                    <td style={tdStyle}>{shortDate(r.performedDateUtc)}</td>
                    <td style={tdStyle}>{r.blockedByGiftName ?? "—"}</td>
                    <td style={tdStyle}>
                      <button type="button" onClick={() => openPrompt(r.memberId)} style={unblockButtonStyle}>
                        Unblock
                      </button>
                    </td>
                  </tr>
                  {promptId === r.memberId && (
                    <tr>
                      <td colSpan={6} style={{ ...tdStyle, background: "var(--bond)" }}>
                        <p style={{ fontSize: 12.5, color: "var(--slate)", marginBottom: 8 }}>
                          Unblocking {r.giftName}. A reason is required and recorded.
                        </p>
                        <input
                          value={reason} onChange={e => setReason(e.target.value)}
                          placeholder="Reason" style={promptInputStyle} autoFocus
                        />
                        {actionError && <p role="alert" style={errorStyle}>{actionError}</p>}
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            type="button" onClick={() => { void confirmUnblock(); }} disabled={busy}
                            style={{ ...unblockButtonStyle, background: "var(--deep)", color: "var(--brass-soft)" }}
                          >
                            {busy ? "…" : "Confirm unblock"}
                          </button>
                          <button type="button" onClick={() => setPromptId(null)} disabled={busy} style={unblockButtonStyle}>
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
      )}
    </div>
  );
}

const tableStyle: CSSProperties = {
  width: "100%", borderCollapse: "collapse", background: "var(--paper)",
  border: "1px solid var(--line)", borderRadius: "var(--r)", minWidth: 720,
};

const thStyle: CSSProperties = {
  textAlign: "left", fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px", fontSize: 13.5, borderBottom: "1px solid var(--line)", minHeight: "var(--tap)",
};

const unblockButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)", fontSize: 12.5,
};

const promptInputStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 14,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const errorStyle: CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--out)", lineHeight: 1.5 };
