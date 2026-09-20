import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import { api, type DownloadedFile } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { ErrorState, ScreenSkeleton } from "@/shared/states";
import type { MyCredential } from "@/shared/types";

/**
 * The only slice of GET /api/members/me this screen reads — reused ONLY for photoUrl,
 * the same "an authenticated <img> would send no Authorization header and 401, so fetch
 * it as a Blob instead" pattern Profile.tsx already uses. Not the full profile shape;
 * extra fields on the real response are simply ignored.
 */
interface MyPhotoLookup {
  photoUrl: string | null;
}

/**
 * A member's own Digital ID (docs/AIS-Project-Documentation.md §4.9), rendered as a
 * tap-to-flip card matching docs/AIS-Mockup.html's .idcard/.idface design:
 *   Front — photo, gift name (more prominent than the legal name, per CLAUDE.md domain
 *           vocabulary), full name, member number, chapter or council chain, date
 *           survive, blood type, status, and a validity line.
 *   Back  — the QR code resolving to the public verification page, a plain-language
 *           explanation of what scanning it shows, and the credential's issue date.
 *
 * Both faces are position:absolute inside one 3D-perspective card (idCardStyle /
 * idFaceStyle); the back face is pre-rotated 180deg so it reads right-way-round once the
 * whole card turns over. There is no public verification PAGE yet — the QR's target
 * route resolves to nothing today; only the card preview is built here.
 *
 * Endpoints:
 *   GET /api/members/me/credential — self-only. Idempotently self-issues the credential
 *                                    on first view (usp_Credential_GetOrIssueForSelf), so
 *                                    there is never a separate "issue my ID" action here.
 *   GET /api/members/me            — read ONLY for photoUrl, same call Profile.tsx makes.
 *   The photo itself is fetched as an authenticated Blob via api.download(photoUrl), the
 *   exact pattern Profile.tsx uses — never a bare <img src="/api/members/{id}/photo">.
 *
 * The QR encodes credential.verificationUrl (a relative "/verify/{token}" path) resolved
 * to an absolute URL against window.location.origin — never a hardcoded domain, and never
 * anything but that opaque token (CLAUDE.md invariant #8).
 *
 * Empty state: none. An authenticated member always has a credential — self-issued on
 * first view — so this screen only has loading/error/loaded states, the same shape as
 * Profile.tsx.
 *
 * This is a read-only self-view: no edit, no delete, no officer-only action of any kind —
 * every member sees his own, in full.
 */
export function DigitalId() {
  const credentialQuery = useQuery({
    queryKey: ["my-credential"],
    queryFn: () => api.get<MyCredential>("/api/members/me/credential"),
    retry: false,
  });

  // Best-effort only. A photo that fails to load falls back to initials, same as
  // Profile.tsx — it never turns this screen into an error state on its own.
  const photoLookup = useQuery({
    queryKey: ["my-photo-lookup"],
    queryFn: () => api.get<MyPhotoLookup>("/api/members/me"),
    retry: false,
  });

  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPhoto() {
      const url = photoLookup.data?.photoUrl;
      if (!url) {
        setPhotoObjectUrl(null);
        return;
      }
      setPhotoLoading(true);
      try {
        const file: DownloadedFile = await api.download(url);
        objectUrl = URL.createObjectURL(file.blob);
        if (!cancelled) setPhotoObjectUrl(objectUrl);
      } catch {
        // Same anti-enumeration 404 GetPhoto gives for "no photo on file" — treat it as
        // plainly having no photo, never as an error banner.
        if (!cancelled) setPhotoObjectUrl(null);
      } finally {
        if (!cancelled) setPhotoLoading(false);
      }
    }

    void loadPhoto();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoLookup.data?.photoUrl]);

  const credential = credentialQuery.data;

  // Rendered at 220px internally so it stays crisp scaled down to the ~92px it displays
  // at on the card's back face — a raster QR only ever loses quality scaling up.
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const verificationUrl = credential?.verificationUrl;
    if (!verificationUrl) {
      setQrDataUrl(null);
      return;
    }
    const absoluteUrl = new URL(verificationUrl, window.location.origin).toString();
    toDataURL(absoluteUrl, { width: 220, margin: 1, color: { dark: "#0E1116", light: "#FFFFFF" } })
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [credential?.verificationUrl]);

  const [flipped, setFlipped] = useState(false);

  if (credentialQuery.isLoading) return <ScreenSkeleton rows={6} />;
  if (credentialQuery.error || !credential) {
    return (
      <ErrorState
        message={credentialQuery.error instanceof Error ? credentialQuery.error.message : undefined}
        onRetry={() => credentialQuery.refetch()}
      />
    );
  }

  // Most specific first, after the chapter itself — the fallback "home" for a detached,
  // council-homed member (CLAUDE.md invariant #14: a member's home of record is a chapter
  // OR a council, never both, never neither).
  const home = credential.chapterName
    ?? credential.cityName
    ?? credential.provinceName
    ?? credential.regionName
    ?? credential.nationalCouncilName
    ?? null;

  return (
    <div style={{ padding: "20px 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>
          Your digital ID
        </h1>
        {/* The only entry point to /scan today — checking a brother's card is something
            you do FROM your own ID screen, not a 5th bottom-nav tab (AppShell.tsx's own
            four-tab-limit reasoning). */}
        <Link
          to="/scan"
          style={{
            flex: "none", minHeight: "var(--tap)", padding: "0 14px", display: "flex",
            alignItems: "center", borderRadius: 8, border: "1px solid var(--line)",
            color: "var(--info)", textDecoration: "none", fontSize: 13, letterSpacing: ".02em",
          }}
        >
          Scan a brother&rsquo;s ID
        </Link>
      </div>

      <div style={idStageStyle}>
        <button
          type="button"
          onClick={() => setFlipped(f => !f)}
          aria-pressed={flipped}
          aria-label={flipped ? "Showing the back of your ID. Tap to see the front." : "Showing the front of your ID. Tap to see the back."}
          style={idCardButtonStyle}
        >
          <div style={{ ...idCardStyle, transform: flipped ? "rotateY(180deg)" : undefined }}>
            {/* Front */}
            <div style={idFaceStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                <div style={sealStyle}>ΑΚΡ</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".2em", color: "var(--brass)" }}>
                    ALPHA KAPPA RHO
                  </div>
                  {home && (
                    <div style={{ fontSize: 10, letterSpacing: ".1em", color: "#8B95A3", marginTop: 1 }}>
                      {home.toUpperCase()}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 14 }}>
                <Photo objectUrl={photoObjectUrl} loading={photoLoading} giftName={credential.giftName} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".04em",
                    color: "var(--paper)", lineHeight: 1,
                  }}>
                    {credential.giftName}
                  </div>
                  <div style={{ fontSize: 12, color: "#98A2B0", marginTop: 4 }}>{credential.fullName}</div>

                  <div style={metaGridStyle}>
                    <Meta label="Member no." value={credential.memberNumber} mono />
                    {credential.bloodTypeName && <Meta label="Blood" value={credential.bloodTypeName} mono />}
                    {credential.dateSurvive && <Meta label="Date survive" value={shortDate(credential.dateSurvive)} />}
                    <Meta label="Status" value={credential.statusName} />
                  </div>
                </div>
              </div>

              <div style={stripStyle}>
                <span>{home ?? ""}</span>
                {credential.renewedThrough && <span>Renewed through {shortDate(credential.renewedThrough)}</span>}
              </div>
            </div>

            {/* Back */}
            <div style={{ ...idFaceStyle, ...idFaceBackStyle }}>
              <div style={{ display: "flex", gap: 12, padding: "16px 16px 0" }}>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Verification QR code" width={92} height={92} style={{ flex: "none", borderRadius: 6 }} />
                ) : (
                  <div style={{
                    width: 92, height: 92, flex: "none", borderRadius: 6, background: "var(--paper)",
                    display: "grid", placeItems: "center", color: "var(--mute)", fontSize: 10.5, textAlign: "center",
                  }}>
                    Preparing…
                  </div>
                )}
                <div style={{ fontSize: 10.5, lineHeight: 1.55, color: "#98A2B0" }}>
                  <b style={{
                    display: "block", fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".16em",
                    color: "var(--brass)", textTransform: "uppercase", marginBottom: 5,
                  }}>
                    Verify this ID
                  </b>
                  Scan to open the public verification page. The code is an anonymous link
                  — it carries no personal details of its own.
                  <br /><br />
                  The page shows only photo, gift name, chapter and current status. Nothing else.
                  <br /><br />
                  If this card is found, please return it to the chapter Secretary.
                </div>
              </div>

              <div style={stripStyle}>
                <span>Issued {shortDate(credential.credentialIssuedDateUtc)}</span>
                <span>{home ? `${home.toUpperCase()} · AIS` : "AIS DIGITAL ID"}</span>
              </div>
            </div>
          </div>
        </button>

        <p style={flipHintStyle}>Tap the card to turn it over</p>
      </div>

      <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 16, lineHeight: 1.6, textAlign: "center" }}>
        Your ID updates on its own if your status changes — a suspended card can never be
        shown as active.
      </p>
    </div>
  );
}

function Photo({ objectUrl, loading, giftName }: {
  objectUrl: string | null; loading: boolean; giftName: string;
}) {
  if (loading) return <div style={photoStyle} aria-busy="true" />;
  if (objectUrl) return <img src={objectUrl} alt="" style={{ ...photoStyle, objectFit: "cover" }} />;
  return (
    <div style={{
      ...photoStyle, display: "grid", placeItems: "center",
      fontFamily: "var(--f-disp)", fontSize: 22, color: "var(--brass-soft)",
    }}>
      {(giftName || "—").slice(0, 2).toUpperCase()}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={metaLabelStyle}>{label}</div>
      <div className={mono ? "num" : undefined} style={metaValueStyle}>{value}</div>
    </div>
  );
}

// The flip card: two absolutely-positioned faces sharing one 3D-perspective stage, the
// back pre-rotated 180deg so it reads right-way-round once the whole card turns over.
// A fixed minHeight is required — position:absolute faces contribute no size of their
// own to the container, so without one the card would collapse to zero height.
const idStageStyle: CSSProperties = { perspective: 1400 };

const idCardButtonStyle: CSSProperties = {
  display: "block", width: "100%", padding: 0, border: "none", background: "none",
  font: "inherit", textAlign: "left", cursor: "pointer", appearance: "none",
};

const idCardStyle: CSSProperties = {
  position: "relative", minHeight: 240, transformStyle: "preserve-3d",
  transition: "transform .6s cubic-bezier(.4,.1,.2,1)",
};

const idFaceStyle: CSSProperties = {
  position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 14,
  overflow: "hidden", padding: "16px 16px 32px",
  background: "linear-gradient(160deg, #232B39 0%, #171D28 55%, #0E1116 100%)",
  border: "1px solid #333C4A", color: "var(--bond)",
  boxShadow: "0 14px 34px rgba(0,0,0,.35)",
};

const idFaceBackStyle: CSSProperties = { transform: "rotateY(180deg)" };

const flipHintStyle: CSSProperties = {
  textAlign: "center", fontSize: 11.5, color: "var(--mute)", marginTop: 11, letterSpacing: ".03em",
};

const sealStyle: CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", border: "1.5px solid var(--brass)",
  display: "grid", placeItems: "center", fontFamily: "var(--f-disp)", fontSize: 12,
  color: "var(--brass)", fontWeight: 700, flex: "none",
};

const photoStyle: CSSProperties = {
  width: 72, height: 88, borderRadius: 8, flex: "none",
  background: "#2A323F", border: "1px solid #3A4453",
};

const metaGridStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginTop: 12,
};

const metaLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase",
  color: "#6F7A88",
};

const metaValueStyle: CSSProperties = {
  fontSize: 12, color: "var(--brass-soft)", marginTop: 2,
};

const stripStyle: CSSProperties = {
  position: "absolute", left: 0, right: 0, bottom: 0, padding: "8px 16px",
  background: "rgba(195,154,62,.13)", borderTop: "1px solid rgba(195,154,62,.3)",
  display: "flex", justifyContent: "space-between", gap: 10, fontSize: 10.5, letterSpacing: ".05em",
  color: "var(--brass)",
};
