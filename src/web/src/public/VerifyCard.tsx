import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { isVerificationTokenShape } from "@/shared/verificationToken";
import { ID_CARD, NotPaidWatermark } from "@/shared/idCardTheme";
import type { PublicVerificationDto } from "@/shared/types";

type ScreenState = "checking" | "verified" | "invalid" | "unavailable";

/**
 * /verify/:token — PUBLIC. No auth, no app chrome, no chapter mark (CLAUDE.md's own
 * vocabulary table: the chapter mark is "absent from the public verification page"). This
 * is the page a stranger's plain phone camera opens directly by scanning the QR on the
 * back of a digital ID (DigitalId.tsx) — no login, quite possibly no app installed.
 *
 * Visuals redesigned 2026-09-29 to match the client-supplied front.png/back.png ID card
 * template — the same dark, emerald-green identity DigitalId.tsx uses (ID_CARD, shared/
 * idCardTheme.tsx), scoped to these two screens only.
 *
 * Endpoint: POST /api/verifications, body { token }. Response mirrors
 * PublicVerificationDto — isValid collapses invalid/revoked/expired into one outcome;
 * never guessed or elaborated on here. photoUrl, when present, is a relative anonymous
 * url (GET /api/verifications/{token}/photo); a plain <img> is enough since that endpoint
 * needs no Authorization header, unlike DigitalId's own photo. A missing or 404ing photo
 * falls back to initials — normal, never an error.
 *
 * A malformed/missing :token (not a guid) short-circuits straight to the red state
 * without ever calling the API — there is nothing to ask the server about.
 *
 * NOT YET PAID watermark (client decision 2026-09-29): shown whenever result.isPaid is
 * false on an otherwise-valid card — the standalone payment tag, never RenewedThrough.
 * Watermark only, never a block: the page still shows the card in full either way.
 *
 * There is no sign-in link and no navigation of any kind on this page by design: a
 * stranger with no account should never be invited to "sign in" from here. It is a
 * dead-end informational page.
 */
export function VerifyCard() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<ScreenState>("checking");
  const [result, setResult] = useState<PublicVerificationDto | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isVerificationTokenShape(token)) {
      setState("invalid");
      return;
    }

    (async () => {
      try {
        const res = await api.post<PublicVerificationDto>("/api/verifications", { token });
        if (cancelled) return;
        setResult(res);
        setState(res.isValid ? "verified" : "invalid");
      } catch {
        // A network failure reaching the server is not a verdict on the card — grey,
        // never red. "Never render a confident state you cannot back."
        if (!cancelled) setState("unavailable");
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div style={sealStyle}>AKP</div>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 24, fontWeight: 700, color: ID_CARD.accent, marginTop: 10 }}>
          AIS
        </div>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".16em", color: ID_CARD.white, marginTop: 4 }}>
          ALPHA KAPPA RHO
        </div>
        <div style={{ fontSize: 11, color: ID_CARD.muted, marginTop: 4 }}>Membership verification</div>
      </div>

      <div style={{ position: "relative" }}>
        {state === "verified" && <NotPaidWatermark isPaid={result?.isPaid ?? false} />}

        {state === "checking" && (
          <p style={centerHintStyle}>Checking…</p>
        )}

        {state === "verified" && result && (
          <div style={{ textAlign: "center", padding: "26px 20px 8px" }}>
            <Photo
              url={result.photoUrl}
              failed={photoFailed}
              onFail={() => setPhotoFailed(true)}
              giftName={result.giftName}
            />
            <div style={giftNameStyle}>{result.giftName ?? "—"}</div>
            {result.chapterName && <div style={chapterNameStyle}>{result.chapterName}</div>}
            {result.statusName && (
              <div style={{ marginTop: 14 }}>
                <span style={statusPillStyle}>{result.statusName.toUpperCase()}</span>
              </div>
            )}
            {result.renewedThrough && (
              <div className="num" style={renewedStyle}>Renewed through {shortDate(result.renewedThrough)}</div>
            )}
            <p style={confirmedLineStyle}>Verified · checked just now</p>
          </div>
        )}

        {state === "invalid" && (
          <div style={messagePanelStyle}>
            <p style={{ ...messageTitleStyle, color: "#E0523F" }}>This ID is not valid.</p>
          </div>
        )}

        {state === "unavailable" && (
          <div style={messagePanelStyle}>
            <p style={{ ...messageTitleStyle, color: ID_CARD.muted }}>Can't check right now</p>
            <p style={messageBodyStyle}>
              No signal — this ID could not be checked. Try again when you have a connection.
            </p>
          </div>
        )}
      </div>

      {state === "verified" && (
        <p style={footnoteStyle}>
          This page shows only photo, gift name, chapter and current status. No contact
          number, no address, no records.
        </p>
      )}
    </div>
  );
}

function Photo({ url, failed, onFail, giftName }: {
  url: string | null; failed: boolean; onFail: () => void; giftName: string | null;
}) {
  if (url && !failed) {
    const absoluteUrl = new URL(url, window.location.origin).toString();
    return <img src={absoluteUrl} alt="" style={photoStyle} onError={onFail} />;
  }
  return (
    <div style={{ ...photoStyle, display: "grid", placeItems: "center", background: "#152019" }}>
      <span style={{ fontFamily: "var(--f-disp)", fontSize: 30, color: ID_CARD.accentSoft }}>
        {(giftName || "—").slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100dvh", background: ID_CARD.bg, color: ID_CARD.white };

const headerStyle: CSSProperties = {
  padding: "28px 16px 22px", textAlign: "center", borderBottom: `1px solid ${ID_CARD.border}`,
};

const sealStyle: CSSProperties = {
  width: 48, height: 48, borderRadius: "50%", border: `2px solid ${ID_CARD.accent}`, margin: "0 auto",
  display: "grid", placeItems: "center", fontFamily: "var(--f-disp)", fontSize: 15,
  color: ID_CARD.accent, fontWeight: 700,
};

const centerHintStyle: CSSProperties = {
  textAlign: "center", padding: "40px 20px", color: ID_CARD.muted, fontSize: 14,
};

const photoStyle: CSSProperties = {
  width: 96, height: 96, borderRadius: "50%", objectFit: "cover", margin: "0 auto",
  border: `1px solid ${ID_CARD.border}`,
};

const giftNameStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 28, letterSpacing: ".04em", marginTop: 14, color: ID_CARD.white,
};

const chapterNameStyle: CSSProperties = { fontSize: 13, color: ID_CARD.muted, marginTop: 4 };

const statusPillStyle: CSSProperties = {
  display: "inline-block", padding: "5px 14px", borderRadius: 999, fontSize: 12,
  letterSpacing: ".04em", background: "rgba(46,216,160,.14)", color: ID_CARD.accent,
  border: `1px solid ${ID_CARD.border}`, fontFamily: "var(--f-disp)",
};

const renewedStyle: CSSProperties = { fontSize: 11, color: ID_CARD.muted, marginTop: 12 };

const confirmedLineStyle: CSSProperties = { fontSize: 12.5, color: ID_CARD.accent, marginTop: 18 };

const messagePanelStyle: CSSProperties = { padding: "48px 24px", textAlign: "center" };

const messageTitleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".02em" };

const messageBodyStyle: CSSProperties = {
  fontSize: 13.5, color: ID_CARD.muted, marginTop: 10, lineHeight: 1.6,
};

const footnoteStyle: CSSProperties = {
  fontSize: 12, color: ID_CARD.muted, lineHeight: 1.6, textAlign: "center", padding: "18px 24px 32px",
};
