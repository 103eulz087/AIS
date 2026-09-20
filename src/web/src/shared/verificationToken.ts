/**
 * Shared by Scan.tsx (extracting a token from a decoded QR payload) and VerifyCard.tsx
 * (validating the token already sitting in the route param before calling the API with
 * it) — one definition of "looks like a real verification token" so the two screens can
 * never drift on what a malformed one looks like.
 *
 * The QR on a digital ID (DigitalId.tsx) encodes an ABSOLUTE url resolving to
 * "/verify/{token}" (CLAUDE.md invariant #8: the token itself is opaque, never a
 * MemberId or a name) — this only ever pulls the guid shape back out, it never inspects
 * or trusts anything else about the payload.
 */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_SEARCH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** True only for a bare, well-formed guid string — used to validate a route param. */
export function isVerificationTokenShape(value: string | null | undefined): value is string {
  return !!value && GUID_PATTERN.test(value);
}

/**
 * Pulls a verification token's guid back out of a decoded QR payload, which is expected
 * to be an absolute (or, defensively, relative) "/verify/{token}" url. Returns null for
 * anything that isn't recognisably one of ours — the caller keeps scanning rather than
 * treating an unrelated QR code as an error.
 */
export function extractVerificationToken(decodedText: string): string | null {
  try {
    const url = new URL(decodedText, window.location.origin);
    const match = GUID_SEARCH.exec(url.pathname);
    if (match) return match[0];
  } catch {
    // Not a url at all — fall through to a bare pattern search below.
  }
  const fallback = GUID_SEARCH.exec(decodedText);
  return fallback ? fallback[0] : null;
}
