import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import { api, ApiError } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canManageChapterInviteLink } from "@/shared/roles";
import type { ChapterInviteLinkIssued, ChapterInviteLinkStatus } from "@/shared/types";

/**
 * A Chapter Admin's own permanent join link/QR code (CLAUDE.md invariant #13 is
 * untouched by this — the link only pre-fills a public membership APPLICATION's chosen
 * chapter; a council still enrols nobody, and neither does a bare link. The chapter's
 * own admin still reviews and approves every applicant, exactly as before).
 *
 * Endpoints:
 *   GET  /api/chapters/me/invite-link            — whether one currently exists, and since when
 *   POST /api/chapters/me/invite-link/regenerate — SHOW-ONCE: the only response that will
 *                                                   ever carry the new link's raw token
 *
 * There is no way to recover a previously-issued link's raw value — only the hash was
 * ever stored. Generating a new one immediately invalidates whatever was live before, so
 * this screen never shows two links as simultaneously valid.
 */
export function InviteMembers() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canManage = canManageChapterInviteLink(roles);

  const statusQuery = useQuery({
    queryKey: ["chapter-invite-link-status"],
    queryFn: () => api.get<ChapterInviteLinkStatus>("/api/chapters/me/invite-link"),
    enabled: canManage,
    retry: false,
  });

  const [issued, setIssued] = useState<ChapterInviteLinkIssued | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    setCopied(false);
    try {
      const res = await api.post<ChapterInviteLinkIssued>("/api/chapters/me/invite-link/regenerate");
      setIssued(res);
      setQrDataUrl(null);
      // Rendered larger than DigitalId's own QR (this is meant to be shown on a screen
      // or printed, not scaled down onto a card back face) — best-effort only: a member
      // can still copy/share the link text itself if this fails for any reason.
      try {
        const dataUrl = await toDataURL(res.joinUrl, {
          width: 260, margin: 1, color: { dark: "#0E1116", light: "#FFFFFF" },
        });
        setQrDataUrl(dataUrl);
      } catch { /* the link text below still works without a QR image */ }
      await statusQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function copyLink() {
    if (!issued) return;
    navigator.clipboard?.writeText(issued.joinUrl)
      .then(() => setCopied(true))
      .catch(() => { /* clipboard permission denied — the link is still on screen */ });
  }

  if (!canManage) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter admin can generate an invite link."
      />
    );
  }

  if (statusQuery.isLoading) return <ScreenSkeleton rows={4} />;
  if (statusQuery.error) {
    return <ErrorState message={(statusQuery.error as Error).message} onRetry={() => statusQuery.refetch()} />;
  }

  const hasLink = statusQuery.data?.hasLink ?? false;

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Invite members</h1>
      <p style={bodyTextStyle}>
        Share this link or QR code with anyone joining your chapter. It takes them straight to
        your chapter's own sign-up form — no need to pick a region, province, or city first.
      </p>

      {issued ? (
        <div style={cardStyle}>
          {qrDataUrl && (
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <img src={qrDataUrl} alt="Join link QR code" width={220} height={220} />
            </div>
          )}
          <div style={linkBoxStyle}>{issued.joinUrl}</div>
          <button type="button" onClick={copyLink} style={ghostButtonStyle}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <p style={hintStyle}>
            Save this now — for security, this exact link is shown only once and cannot be
            recovered later. Generating a new one below will stop this one from working.
          </p>
        </div>
      ) : hasLink ? (
        <div style={cardStyle}>
          <p style={{ ...bodyTextStyle, marginTop: 0 }}>
            Your chapter already has an active join link
            {statusQuery.data?.createdDateUtc ? ` — created ${shortDate(statusQuery.data.createdDateUtc)}.` : "."}
            {" "}It was shown only once, right when it was created. If you no longer have it, generate
            a new one below — this will stop the old one from working.
          </p>
        </div>
      ) : (
        <div style={cardStyle}>
          <p style={{ ...bodyTextStyle, marginTop: 0 }}>Your chapter doesn't have a join link yet.</p>
        </div>
      )}

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      <button
        type="button" disabled={generating} onClick={() => { void handleGenerate(); }}
        style={{ ...buttonStyle, opacity: generating ? 0.7 : 1 }}
      >
        {generating ? "Generating…" : hasLink || issued ? "Generate a new link" : "Generate join link"}
      </button>
    </div>
  );
}

const pageStyle: CSSProperties = { padding: "20px 16px 40px" };

const titleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" };

const bodyTextStyle: CSSProperties = { fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6, marginTop: 8 };

const cardStyle: CSSProperties = {
  marginTop: 18, padding: 16, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)",
};

const linkBoxStyle: CSSProperties = {
  padding: 10, borderRadius: 8, background: "var(--bond)",
  border: "1px solid var(--line)", fontSize: 12.5, wordBreak: "break-all", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 12, lineHeight: 1.6 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 18, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};

const ghostButtonStyle: CSSProperties = {
  marginTop: 10, minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)", width: "100%",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};
