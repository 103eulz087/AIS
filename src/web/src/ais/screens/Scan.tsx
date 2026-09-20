import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/shared/api";
import { shortDate } from "@/shared/format";
import { extractVerificationToken } from "@/shared/verificationToken";
import type { MemberScanResultDto } from "@/shared/types";

/**
 * A minimal shape for the experimental `window.BarcodeDetector` API — not yet in
 * TypeScript's DOM lib. Chrome/Android only; see the iOS fallback below.
 */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/** Rendered outcome of a completed scan attempt. `null` while still scanning/checking. */
type ScanOutcome = "verified" | "invalid" | "unavailable";

/**
 * /scan — authenticated. An officer or member scanning ANOTHER brother's ID card.
 *
 * Endpoint: POST /api/scans, body { token }. The token is the guid pulled out of the
 * QR's decoded "/verify/{token}" url (shared/verificationToken.ts — the same shape
 * DigitalId.tsx's own QR encodes). Response mirrors MemberScanResultDto: isValid decides
 * green/red; fullName/memberNumber/bloodTypeName only ever arrive when isSameChapter is
 * true (CLAUDE.md invariant #7 carried into this screen — never inferred client-side).
 *
 * Camera: `window.BarcodeDetector` when present (Chrome/Android); iOS Safari has none
 * (CLAUDE.md §8.1 — not optional), so this lazy-imports `zxing-wasm/reader` and decodes
 * sampled video frames through it instead. That dynamic import keeps the wasm chunk out
 * of the main bundle.
 *
 * getUserMedia requires a secure context (CLAUDE.md §8.2). A plain-HTTP deployment will
 * only ever reach the grey "can't check right now" state from this screen — that is
 * expected until TLS is turned on, not a bug to chase.
 *
 * Four states: Scanning (default, camera preview), Verified (green), Not valid (red),
 * Can't check right now (grey — camera/detector unavailable, or the POST itself fails on
 * a network error). Grey is never styled to look like a failed card; no amber state
 * exists in this slice (that is a separate, offline/signed-token verification build).
 *
 * There is no "nothing to show" empty state here — the screen always has exactly one of
 * the four states above, from the moment it mounts.
 */
export function Scan() {
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [result, setResult] = useState<MemberScanResultDto | null>(null);
  // True from the moment a QR is decoded until POST /api/scans resolves — purely a hint
  // swap within the Scanning view, not a fifth rendered state.
  const [checking, setChecking] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const submitScan = useCallback(async (token: string) => {
    try {
      const res = await api.post<MemberScanResultDto>("/api/scans", { token });
      setResult(res);
      setOutcome(res.isValid ? "verified" : "invalid");
    } catch {
      // A network failure calling the server is not a verdict on the card — grey, never
      // red. "Never render a confident state you cannot back."
      setOutcome("unavailable");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (outcome !== null) return; // camera only runs in the Scanning state
    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let intervalId: number | null = null;

    function stopCamera() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (intervalId !== null) window.clearInterval(intervalId);
      stream?.getTracks().forEach(t => t.stop());
      stream = null;
    }

    function handleDecoded(text: string) {
      if (cancelled) return;
      const token = extractVerificationToken(text);
      if (!token) return; // not one of our QR codes — keep scanning
      cancelled = true;
      stopCamera();
      setChecking(true);
      void submitScan(token);
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        // Denied permission, no camera, or (CLAUDE.md §8.2) a plain-HTTP origin, which
        // getUserMedia refuses outright — all three land here, deliberately grey.
        if (!cancelled) setOutcome("unavailable");
        return;
      }
      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => { /* autoplay can reject silently; the loop below still tries */ });

      if (typeof window !== "undefined" && window.BarcodeDetector) {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const loop = () => {
          if (cancelled || !videoRef.current) return;
          detector.detect(videoRef.current)
            .then(codes => {
              const value = codes[0]?.rawValue;
              if (value) handleDecoded(value);
              else if (!cancelled) rafId = requestAnimationFrame(loop);
            })
            .catch(() => { if (!cancelled) rafId = requestAnimationFrame(loop); });
        };
        rafId = requestAnimationFrame(loop);
        return;
      }

      // iOS Safari has no BarcodeDetector — this fallback is not optional (CLAUDE.md
      // §8.1). Dynamic import keeps zxing-wasm's chunk out of the main bundle; it is
      // only ever fetched by a browser that actually needs it.
      let reader: typeof import("zxing-wasm/reader");
      try {
        reader = await import("zxing-wasm/reader");
      } catch {
        if (!cancelled) setOutcome("unavailable");
        return;
      }
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      const sample = () => {
        const video = videoRef.current;
        if (cancelled || !video || video.videoWidth === 0) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        reader.readBarcodesFromImageData(imageData, { formats: ["QRCode"], maxNumberOfSymbols: 1 })
          .then(codes => {
            const value = codes[0]?.text;
            if (value) handleDecoded(value);
          })
          .catch(() => { /* try again on the next sampled frame */ });
      };
      intervalId = window.setInterval(sample, 350);
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [outcome, submitScan]);

  function scanAnother() {
    setResult(null);
    setOutcome(null);
    setChecking(false);
  }

  if (outcome === null) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Scan an ID</h1>
        <div style={stageStyle}>
          {checking ? (
            <div style={checkingBoxStyle}>Checking…</div>
          ) : (
            <>
              <video ref={videoRef} muted playsInline autoPlay style={videoStyle} />
              <div style={viewfinderStyle} aria-hidden="true">
                <span style={{ ...cornerStyle, top: 0, left: 0, borderRight: "none", borderBottom: "none" }} />
                <span style={{ ...cornerStyle, top: 0, right: 0, borderLeft: "none", borderBottom: "none" }} />
                <span style={{ ...cornerStyle, bottom: 0, left: 0, borderRight: "none", borderTop: "none" }} />
                <span style={{ ...cornerStyle, bottom: 0, right: 0, borderLeft: "none", borderTop: "none" }} />
              </div>
            </>
          )}
        </div>
        <p style={hintStyle}>
          {checking ? "Checking the ID…" : "Point the camera at the ID's QR code"}
        </p>
      </div>
    );
  }

  const tone = TONE[outcome];

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Scan an ID</h1>

      <div style={{ ...trustStyle, background: tone.background, border: `1px solid ${tone.border}` }}>
        <span style={{ ...dotStyle, background: tone.dot }} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...trustTitleStyle, color: tone.dot }}>{tone.headline}</div>
          {outcome === "unavailable" && (
            <div style={trustBodyStyle}>
              No signal — this ID could not be checked. Try again when you have a connection.
            </div>
          )}
          {outcome === "invalid" && <div style={trustBodyStyle}>This ID is not valid.</div>}
        </div>
      </div>

      {outcome === "verified" && result && (
        <div style={cardStyle}>
          <Field label="Gift name" value={result.giftName ?? "—"} />
          <Field label="Chapter" value={result.chapterName ?? "—"} />
          <Field label="Status" value={result.statusName ?? "—"} />
          {result.renewedThrough && <Field label="Renewed through" value={shortDate(result.renewedThrough)} />}
          {result.isSameChapter && (
            <>
              <Field label="Full name" value={result.fullName ?? "—"} />
              <Field label="Member no." value={result.memberNumber ?? "—"} mono />
              {result.bloodTypeName && <Field label="Blood" value={result.bloodTypeName} mono />}
            </>
          )}
        </div>
      )}

      <button type="button" onClick={scanAnother} style={scanAgainButtonStyle}>Scan another</button>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={fieldRowStyle}>
      <div style={fieldLabelStyle}>{label}</div>
      <div className={mono ? "num" : undefined} style={fieldValueStyle}>{value}</div>
    </div>
  );
}

const TONE: Record<ScanOutcome, { background: string; border: string; dot: string; headline: string }> = {
  verified: { background: "#EEF6F2", border: "#C3DBD0", dot: "var(--in)", headline: "Verified · checked just now" },
  invalid: { background: "#FBF0EF", border: "#E4C4C0", dot: "var(--out)", headline: "This ID is not valid" },
  unavailable: { background: "var(--bond)", border: "var(--line)", dot: "var(--mute)", headline: "Can't check right now" },
};

const pageStyle: CSSProperties = { padding: "20px 16px 40px" };

const titleStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em", marginBottom: 16,
};

const stageStyle: CSSProperties = {
  borderRadius: 14, aspectRatio: "1 / 1", background: "#0B0E13", position: "relative",
  overflow: "hidden", display: "grid", placeItems: "center",
};

const videoStyle: CSSProperties = {
  position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
};

const checkingBoxStyle: CSSProperties = {
  color: "var(--brass-soft)", fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".06em",
};

const viewfinderStyle: CSSProperties = { width: "62%", aspectRatio: "1 / 1", position: "relative" };

const cornerStyle: CSSProperties = {
  position: "absolute", width: 28, height: 28, border: "3px solid var(--brass)", borderRadius: 7,
};

const hintStyle: CSSProperties = {
  textAlign: "center", fontSize: 12.5, color: "var(--mute)", marginTop: 12, letterSpacing: ".02em",
};

const trustStyle: CSSProperties = {
  display: "flex", gap: 11, alignItems: "flex-start", padding: "14px 16px", borderRadius: 10, marginTop: 4,
};

const dotStyle: CSSProperties = { width: 11, height: 11, borderRadius: "50%", flex: "none", marginTop: 4 };

const trustTitleStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".02em",
};

const trustBodyStyle: CSSProperties = { fontSize: 13, color: "var(--slate)", marginTop: 4, lineHeight: 1.5 };

const cardStyle: CSSProperties = {
  marginTop: 14, padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", display: "grid", gap: 10,
};

const fieldRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };

const fieldLabelStyle: CSSProperties = { fontSize: 12.5, color: "var(--mute)" };

const fieldValueStyle: CSSProperties = { fontSize: 13.5, color: "var(--ink)", textAlign: "right" };

const scanAgainButtonStyle: CSSProperties = {
  marginTop: 18, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".08em", textTransform: "uppercase",
};
