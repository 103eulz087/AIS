import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import { api, type DownloadedFile } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { ErrorState, ScreenSkeleton } from "@/shared/states";
import { ID_CARD, NotPaidWatermark } from "@/shared/idCardTheme";
import { ChapterMonogram } from "@/ais/screens/ChapterMonogram";
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
 * tap-to-flip card. Visuals redesigned 2026-09-29 to match the client-supplied front.png/
 * back.png ID card template — dark, emerald-green identity (ID_CARD, shared/
 * idCardTheme.tsx), scoped to this screen and VerifyCard.tsx only; every other screen
 * keeps the app's existing navy/brass identity.
 *   Front — org wordmark, photo, chapter, member no., blood type, a circular chapter
 *           mark, the Officer/Member tag, and a footer carrying the gift name (more
 *           prominent than the legal name, per CLAUDE.md domain vocabulary).
 *   Back  — the National Council seal, the QR code resolving to the public verification
 *           page, a plain-language explanation of what scanning it shows, and the
 *           credential's issue date.
 *
 * Both faces are position:absolute inside one 3D-perspective card (idCardStyle /
 * idFaceStyle); the back face is pre-rotated 180deg so it reads right-way-round once the
 * whole card turns over.
 *
 * NOT YET PAID watermark (client decision 2026-09-29): a diagonal, non-blocking stamp on
 * both faces when credential.isPaid is false — the standalone payment tag
 * (dbo.MemberPaymentTagAction), never RenewedThrough. An untagged member reads as NOT
 * paid, so this shows for the whole roster by default until National works through it.
 * Watermark only — the card still opens and the QR still verifies either way.
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
 * Two card designs, chosen by credential.officePosition (usp_Credential_GetOrIssueForSelf):
 *   - Member  — the emerald/black outline (ID_CARD's own identity).
 *   - Officer — a red/black outline, plus his position (and the chapter or council he
 *               holds it in) on the front, so a seated officer is identifiable at a glance.
 * The position lives on the card face only — never in the QR or on the public
 * verification page (CLAUDE.md invariant #8).
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

  // Chapter mark, image slice (2026-09-29). Same authenticated-Blob pattern as the
  // member photo above (chapter-logo/photo endpoints both need Authorization headers a
  // bare <img src> would never send) — fetched only once credential.chapterLogoUrl is
  // known to be non-null, so a chapter with no logo yet never even attempts the call.
  const [chapterLogoObjectUrl, setChapterLogoObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadChapterLogo() {
      const url = credential?.chapterLogoUrl;
      if (!url) {
        setChapterLogoObjectUrl(null);
        return;
      }
      try {
        const file: DownloadedFile = await api.download(url);
        objectUrl = URL.createObjectURL(file.blob);
        if (!cancelled) setChapterLogoObjectUrl(objectUrl);
      } catch {
        if (!cancelled) setChapterLogoObjectUrl(null);
      }
    }

    void loadChapterLogo();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [credential?.chapterLogoUrl]);

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
    toDataURL(absoluteUrl, { width: 220, margin: 1, color: { dark: "#0B120E", light: "#FFFFFF" } })
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

  // Only shown alongside an actual chapter name — a detached, council-homed member has
  // no chapter to disambiguate, and "home" already fell back to this same value in that
  // case, so repeating it would just be the same text twice.
  const municipalityLabel = credential.chapterName
    ? (credential.cityName ?? credential.provinceName ?? credential.regionName ?? null)
    : null;

  const isOfficer = !!credential.officePosition;
  const theme = isOfficer ? OFFICER_THEME : MEMBER_THEME;
  const faceStyle: CSSProperties = { ...idFaceStyle, border: `2px solid ${theme.accent}` };
  const footerThemed: CSSProperties = { ...footerStyle, background: theme.stripBg, borderTop: `1px solid ${theme.accent}` };

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
          data-tour="digital-id-scan-link"
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
          data-tour="digital-id-card"
          onClick={() => setFlipped(f => !f)}
          aria-pressed={flipped}
          aria-label={flipped ? "Showing the back of your ID. Tap to see the front." : "Showing the front of your ID. Tap to see the back."}
          style={idCardButtonStyle}
        >
          <div style={{ ...idCardStyle, transform: flipped ? "rotateY(180deg)" : undefined }}>
            {/* Front */}
            <div style={faceStyle}>
              <NotPaidWatermark isPaid={credential.isPaid} />
              <div style={headerRowStyle}>
                <div style={wordmarkStyle}>AIS</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={orgLineStyle}>ALPHA KAPPA RHO</div>
                  <div style={sysLineStyle}>INFORMATION SYSTEM</div>
                  <div style={cardLineStyle}>MEMBER IDENTIFICATION CARD</div>
                </div>
                {/* The National Council seal — same placement as the back face's own
                    header, top-right aligned with the AIS wordmark. */}
                <img src="/national-seal.jpg" alt="AKRHO National Council seal" style={nationalSealStyle} />
              </div>
              <div style={dividerStyle} />

              {/* Member No., Blood type and Chapter beside the photo (client decision
                  2026-09-30), the full name — and, for a seated officer, his position —
                  at the TOP of that column, aligned with the photo's own top edge; the
                  chapter mark and the Officer/Member tag share this same row too. */}
              <div style={{ display: "flex", gap: 14, marginTop: 14, alignItems: "flex-start" }}>
                <Photo objectUrl={photoObjectUrl} loading={photoLoading} giftName={credential.giftName} accent={theme.accent} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={topNameStyle}>{credential.fullName}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    <Meta label="Chapter" value={home ?? "—"} />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <Meta label="Member no." value={credential.memberNumber} mono />
                      {credential.bloodTypeName && (
                        <div style={{ textAlign: "right" }}>
                          <Meta label="Blood" value={credential.bloodTypeName} mono />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* The chapter mark — for ownership, per the chapter's own choice.
                    Borderless/no background whenever a real logo is on file, so a
                    transparent-background upload's own artwork shows through with
                    nothing added (client decision 2026-09-29); falls back to the
                    generated initials-and-accent monogram until the President uploads
                    one. */}
                <div style={{ flex: "none" }}>
                  {chapterLogoObjectUrl ? (
                    <img src={chapterLogoObjectUrl} alt={`${home ?? "Chapter"} logo`} style={chapterLogoStyle} />
                  ) : (
                    <ChapterMonogram
                      chapterName={home ?? ""}
                      hexValue={credential.chapterMarkAccentHex ?? ID_CARD.accentDim}
                      size={40}
                    />
                  )}
                </div>
              </div>

              {/* The Officer/Member tag — moved outside the footer (client decision
                  2026-10-06), sitting just above its coloured top border rather than
                  inside the footer's own padding. */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <div style={{ ...roleTagStyle, background: theme.accent }}>
                  {isOfficer ? "Officer" : "Member"}
                </div>
              </div>

              <div style={footerThemed}>
                {/* Chapter name, prominent — gift name moved to the back (client
                    decision 2026-10-06; it's already shown here on the front, in the
                    Chapter field beside the photo, so showing it again would be
                    redundant). Chapters are named with Greek letters and the same
                    Greek name can recur in different municipalities, so the
                    municipality/city is shown right below it to disambiguate. */}
                <div style={{ minWidth: 0 }}>
                  <div style={giftNameFooterStyle}>{credential.chapterName ?? home ?? "—"}</div>
                  {credential.chapterName && municipalityLabel && (
                    <div style={footerSubTextStyle}>{municipalityLabel}</div>
                  )}
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  {isOfficer && (
                    <div style={{ ...positionStyle, color: theme.accent, marginTop: 0 }}>
                      {credential.officePosition}
                    </div>
                  )}
                  {isOfficer && credential.officeBody && (
                    <div style={{ fontSize: 10, color: theme.soft }}>{credential.officeBody}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Back */}
            <div style={{ ...faceStyle, ...idFaceBackStyle }}>
              <NotPaidWatermark isPaid={credential.isPaid} />
              <div style={headerRowStyle}>
                <div style={wordmarkStyle}>AIS</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={orgLineStyle}>VERIFICATION</div>
                  <div style={sysLineStyle}>ALPHA KAPPA RHO INFORMATION SYSTEM</div>
                </div>
                {/* The National Council seal — same on every member's card, every
                    chapter, unlike the chapter-specific mark on the front face. */}
                <img src="/national-seal.jpg" alt="AKRHO National Council seal" style={nationalSealStyle} />
              </div>
              <div style={dividerStyle} />

              <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
                <div style={{ flex: 1, fontSize: 11, lineHeight: 1.6, color: ID_CARD.muted }}>
                  <p style={{ color: ID_CARD.white, fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>
                    Scan to verify this card.
                  </p>
                  <p style={{ margin: 0 }}>
                    Opens a public page showing photo, name, chapter and current status.
                    No personal data is stored in the code.
                  </p>
                  <p style={{ color: theme.accent, fontSize: 10, letterSpacing: ".14em", margin: "12px 0 4px" }}>
                    IF FOUND
                  </p>
                  <p style={{ margin: 0 }}>
                    Return to the chapter secretary or any AKRHO council office.
                  </p>
                </div>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Verification QR code" width={88} height={88} style={{ flex: "none", borderRadius: 6 }} />
                ) : (
                  <div style={{
                    width: 88, height: 88, flex: "none", borderRadius: 6, background: ID_CARD.white,
                    display: "grid", placeItems: "center", color: "#5C6A63", fontSize: 10, textAlign: "center",
                  }}>
                    Preparing…
                  </div>
                )}
              </div>

              <div style={footerThemed}>
                <span style={footerTextStyle}>Issued {shortDate(credential.credentialIssuedDateUtc)}</span>
                {/* Gift name — moved here from the chapter/home display (client decision
                    2026-10-06): the chapter is already shown prominently on the front,
                    so the back carries the member's own identity instead. */}
                <span style={footerTextStyle}>{credential.giftName}</span>
              </div>
            </div>
          </div>
        </button>

        <p data-tour="digital-id-flip-hint" style={flipHintStyle}>Tap the card to turn it over</p>
      </div>

      <p data-tour="digital-id-status-note" style={{ fontSize: 12, color: "var(--mute)", marginTop: 16, lineHeight: 1.6, textAlign: "center" }}>
        Your ID updates on its own if your status changes — a suspended card can never be
        shown as active.
      </p>
    </div>
  );
}

function Photo({ objectUrl, loading, giftName, accent }: {
  objectUrl: string | null; loading: boolean; giftName: string; accent: string;
}) {
  const framed: CSSProperties = { ...photoStyle, border: `1.5px solid ${accent}` };
  if (loading) return <div style={framed} aria-busy="true" />;
  if (objectUrl) return <img src={objectUrl} alt="" style={{ ...framed, objectFit: "cover" }} />;
  return (
    <div style={{
      ...framed, display: "grid", placeItems: "center",
      fontFamily: "var(--f-disp)", fontSize: 22, color: accent,
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
// back pre-rotated 180deg so it reads right-way-round once the whole card turns over. A
// fixed minHeight is required — position:absolute faces contribute no size of their own
// to the container, so without one the card would collapse to zero height. 262, not 250
// — tall enough for an officer card's extra position line.
const idStageStyle: CSSProperties = { perspective: 1400 };

const idCardButtonStyle: CSSProperties = {
  display: "block", width: "100%", padding: 0, border: "none", background: "none",
  font: "inherit", textAlign: "left", cursor: "pointer", appearance: "none",
};

const idCardStyle: CSSProperties = {
  position: "relative", minHeight: 262, transformStyle: "preserve-3d",
  transition: "transform .6s cubic-bezier(.4,.1,.2,1)",
};

// Member = ID_CARD's own emerald identity; officer = red, so a seated officer's card is
// identifiable at a glance (client decision, Search-the-queue/officer-card slice). The
// card body/background is the same ID_CARD.bg for both — only the accent (outline, role
// tag, position line, photo frame, footer tint) tells them apart.
const MEMBER_THEME = {
  accent: "var(--id-member)", soft: "var(--id-member-soft)", stripBg: "rgba(47,165,98,.16)",
};
const OFFICER_THEME = {
  accent: "var(--id-officer)", soft: "var(--id-officer-soft)", stripBg: "rgba(211,48,47,.16)",
};

const idFaceStyle: CSSProperties = {
  position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 14,
  overflow: "hidden", padding: "16px 16px 40px",
  background: ID_CARD.bg, color: ID_CARD.white,
  boxShadow: "0 14px 34px rgba(0,0,0,.45)",
};

const roleTagStyle: CSSProperties = {
  flex: "none", padding: "3px 8px", borderRadius: 4, color: "#FFFFFF",
  fontFamily: "var(--f-disp)", fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase",
};

const positionStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 13, fontWeight: 600, letterSpacing: ".1em",
  textTransform: "uppercase", marginTop: 4,
};

const idFaceBackStyle: CSSProperties = { transform: "rotateY(180deg)" };

const flipHintStyle: CSSProperties = {
  textAlign: "center", fontSize: 11.5, color: "var(--mute)", marginTop: 11, letterSpacing: ".03em",
};

const headerRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };

const wordmarkStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 26, fontWeight: 700, letterSpacing: ".01em",
  color: ID_CARD.accent, flex: "none", lineHeight: 1,
};

const orgLineStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".12em", color: ID_CARD.white, fontWeight: 700,
};

const sysLineStyle: CSSProperties = {
  fontSize: 10, letterSpacing: ".1em", color: ID_CARD.accent, marginTop: 1,
};

const cardLineStyle: CSSProperties = {
  fontSize: 8.5, letterSpacing: ".1em", color: ID_CARD.muted, marginTop: 1,
};

const dividerStyle: CSSProperties = {
  height: 1, background: ID_CARD.border, marginTop: 10,
};

// Scaled slightly over 100% before the circular clip — the source artwork is a circular
// badge with a thin white margin baked into its square canvas; a straight object-fit:
// cover at 100% would leave a sliver of that white square showing at the mask's corners.
const nationalSealStyle: CSSProperties = {
  width: 40, height: 40, borderRadius: "50%", flex: "none",
  objectFit: "cover", transform: "scale(1.12)",
  border: `1.5px solid ${ID_CARD.accent}`,
};

// No border, no background fill — a transparent PNG logo shows only its own artwork,
// with nothing added by this card (the "borderless" requirement 2026-09-29). Bounded by
// max- rather than fixed width/height so a non-square logo isn't stretched or cropped.
const chapterLogoStyle: CSSProperties = {
  maxWidth: 44, maxHeight: 44, objectFit: "contain", flex: "none",
};

const photoStyle: CSSProperties = {
  width: 66, height: 82, borderRadius: 8, flex: "none",
  background: "#152019",
};

// Aligned with the photo's own top edge (the row's alignItems:"flex-start" is what
// makes that alignment hold) — client decision 2026-09-30: never below the photo.
const topNameStyle: CSSProperties = {
  fontSize: 13, color: ID_CARD.white, fontWeight: 600, lineHeight: 1.3,
};

const metaLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase",
  color: ID_CARD.muted,
};

const metaValueStyle: CSSProperties = {
  fontSize: 13, color: ID_CARD.white, marginTop: 2, fontWeight: 600,
};

const footerStyle: CSSProperties = {
  position: "absolute", left: 0, right: 0, bottom: 0, padding: "9px 16px",
  background: ID_CARD.footerBg, borderTop: `1px solid ${ID_CARD.border}`,
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
};

const giftNameFooterStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 18, letterSpacing: ".04em", color: ID_CARD.white,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};

const footerSubTextStyle: CSSProperties = {
  fontSize: 10.5, color: ID_CARD.accentSoft, marginTop: 1,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};

const footerTextStyle: CSSProperties = {
  fontSize: 10, letterSpacing: ".05em", color: ID_CARD.accentSoft,
};
