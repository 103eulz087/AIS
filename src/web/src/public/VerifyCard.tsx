import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { isVerificationTokenShape } from "@/shared/verificationToken";
import type { PublicVerificationDto } from "@/shared/types";

type ScreenState = "checking" | "verified" | "invalid" | "unavailable";

/**
 * /verify/:token — PUBLIC. No auth, no app chrome, no chapter mark (CLAUDE.md's own
 * vocabulary table: the chapter mark is "absent from the public verification page"). This
 * is the page a stranger's plain phone camera opens directly by scanning the QR on the
 * back of a digital ID (DigitalId.tsx) — no login, quite possibly no app installed.
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
        <div style={sealStyle}>ΑΚΡ</div>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".2em", color: "var(--brass)" }}>
          ALPHA KAPPA RHO
        </div>
        <div style={{ fontSize: 11, color: "#8B95A3", marginTop: 4 }}>Membership verification</div>
      </div>

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
          <p style={{ ...messageTitleStyle, color: "var(--out)" }}>This ID is not valid.</p>
        </div>
      )}

      {state === "unavailable" && (
        <div style={messagePanelStyle}>
          <p style={{ ...messageTitleStyle, color: "var(--mute)" }}>Can't check right now</p>
          <p style={messageBodyStyle}>
            No signal — this ID could not be checked. Try again when you have a connection.
          </p>
        </div>
      )}

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
    <div style={{ ...photoStyle, display: "grid", placeItems: "center", background: "#2A323F" }}>
      <span style={{ fontFamily: "var(--f-disp)", fontSize: 30, color: "var(--brass-soft)" }}>
        {(giftName || "—").slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100dvh", background: "var(--paper)" };

const headerStyle: CSSProperties = {
  background: "var(--deep)", padding: "24px 16px", textAlign: "center",
};

const sealStyle: CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", border: "2px solid var(--brass)", margin: "0 auto 10px",
  display: "grid", placeItems: "center", fontFamily: "var(--f-disp)", fontSize: 16,
  color: "var(--brass)", fontWeight: 700,
};

const centerHintStyle: CSSProperties = {
  textAlign: "center", padding: "40px 20px", color: "var(--mute)", fontSize: 14,
};

const photoStyle: CSSProperties = {
  width: 96, height: 96, borderRadius: "50%", objectFit: "cover", margin: "0 auto",
  border: "1px solid var(--line)",
};

const giftNameStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 28, letterSpacing: ".04em", marginTop: 14, color: "var(--ink)",
};

const chapterNameStyle: CSSProperties = { fontSize: 13, color: "var(--mute)", marginTop: 4 };

const statusPillStyle: CSSProperties = {
  display: "inline-block", padding: "5px 14px", borderRadius: 999, fontSize: 12,
  letterSpacing: ".04em", background: "#EEF6F2", color: "var(--in)", fontFamily: "var(--f-disp)",
};

const renewedStyle: CSSProperties = { fontSize: 11, color: "var(--mute)", marginTop: 12 };

const confirmedLineStyle: CSSProperties = { fontSize: 12.5, color: "var(--in)", marginTop: 18 };

const messagePanelStyle: CSSProperties = { padding: "48px 24px", textAlign: "center" };

const messageTitleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 20, letterSpacing: ".02em" };

const messageBodyStyle: CSSProperties = {
  fontSize: 13.5, color: "var(--slate)", marginTop: 10, lineHeight: 1.6,
};

const footnoteStyle: CSSProperties = {
  fontSize: 12, color: "var(--mute)", lineHeight: 1.6, textAlign: "center", padding: "18px 24px 32px",
};
