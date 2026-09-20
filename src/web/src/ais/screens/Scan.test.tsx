/**
 * /scan — authenticated in-app camera scan. Covers the four render states Scan.tsx's own
 * header comment promises: Scanning (default), Verified (green), Not valid (red), Can't
 * check right now (grey — camera/detector unavailable, or a network failure).
 *
 * jsdom has no navigator.mediaDevices at all (confirmed by smoke.test.tsx's own comment
 * on this same screen) — getUserMedia() rejecting is therefore the DEFAULT, no stub
 * needed, and lands on the grey state exactly the way a plain-HTTP deployment or a
 * denied camera permission would (CLAUDE.md §8.2). To reach the verified/invalid states
 * this test drives the rest of the real camera pipeline: a stubbed getUserMedia that
 * resolves, and a stubbed window.BarcodeDetector whose first detect() call immediately
 * "sees" a QR encoding a /verify/{token} url — the same shape DigitalId.tsx's own QR
 * encodes and shared/verificationToken.ts extracts from. This is the real component
 * logic end to end (no reaching into React internals), just with the two browser-only
 * capabilities it depends on faked, same posture RegisterChapter.test.tsx uses for fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Scan } from "./Scan";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface FetchRule { status: number; body: unknown }

function stubFetch(rules: Array<[matchUrl: string, rule: FetchRule]>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    for (const [key, rule] of rules) {
      if (url.includes(key)) {
        return { ok: rule.status >= 200 && rule.status < 300, status: rule.status, json: async () => rule.body };
      }
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function stubRejectedFetch() {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderScan() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Scan /></MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** A fake MediaStream — just enough shape for Scan.tsx's own stopCamera() to call. */
function fakeMediaStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/**
 * Stubs a working camera + a BarcodeDetector that "sees" the given decoded QR text on
 * its very first detect() call — driving Scan.tsx all the way to submitScan() the same
 * way a real successful scan would, without touching any React internals.
 */
function stubWorkingCameraThatDecodes(decodedText: string) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(fakeMediaStream()) },
  });

  // jsdom's own HTMLMediaElement.play() is unimplemented (returns undefined, not a
  // promise) — Scan.tsx immediately calls `.catch()` on its result, which is exactly the
  // "autoplay can reject silently" case its own comment already tolerates in a REAL
  // browser. Stub play() to behave like a browser here so that line doesn't throw before
  // ever reaching the BarcodeDetector loop this test actually wants to exercise.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

  class FakeBarcodeDetector {
    async detect() { return [{ rawValue: decodedText }]; }
  }
  vi.stubGlobal("BarcodeDetector", FakeBarcodeDetector);
}

function stubCameraUnavailable() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")) },
  });
}

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
// Captured once, restored after every test — see stubWorkingCameraThatDecodes's own
// comment on why this needs overriding at all. vi.restoreAllMocks() only reverts
// vi.spyOn() spies, never a plain property assignment like this one.
const originalMediaElementPlay = HTMLMediaElement.prototype.play;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  HTMLMediaElement.prototype.play = originalMediaElementPlay;
  // navigator.mediaDevices is stubbed per-test via defineProperty (not vi.stubGlobal,
  // which only patches globalThis-level bindings) — restore jsdom's own original
  // (typically absent) descriptor so a leftover stub can never bleed into another file.
  if (mediaDevicesDescriptor) {
    Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  } else {
    delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  }
});

describe("Scan", () => {
  it("renders the grey 'No signal' state when the camera is unavailable — never red", async () => {
    stubCameraUnavailable();

    await renderScan();

    expect(container.textContent).toContain("Can't check right now");
    expect(container.textContent).toContain("No signal");
    expect(container.textContent).not.toContain("This ID is not valid.");
  });

  it("renders the verified state with the extra fields when isSameChapter is true", async () => {
    stubFetch([
      ["/api/scans", {
        status: 200,
        body: {
          isValid: true, giftName: "TANGLAW", chapterName: "Brgy. San Isidro Chapter",
          statusName: "Active", renewedThrough: "2027-08-08",
          isSameChapter: true, fullName: "Ramon Delgado", memberNumber: "AKR-04-0117-001", bloodTypeName: "O+",
        },
      }],
    ]);
    stubWorkingCameraThatDecodes("https://app.example/verify/3f2a1c9e-89aa-4b7a-8f0a-000000000000");

    await renderScan();
    await settle();

    expect(container.textContent).toContain("Verified");
    expect(container.textContent).toContain("TANGLAW");
    expect(container.textContent).toContain("Ramon Delgado");
    expect(container.textContent).toContain("AKR-04-0117-001");
    expect(container.textContent).toContain("O+");
  });

  it("renders the verified state WITHOUT the extra fields when isSameChapter is false", async () => {
    stubFetch([
      ["/api/scans", {
        status: 200,
        body: {
          isValid: true, giftName: "BAGWIS", chapterName: "Some Other Chapter",
          statusName: "Active", renewedThrough: "2027-08-08",
          isSameChapter: false, fullName: null, memberNumber: null, bloodTypeName: null,
        },
      }],
    ]);
    stubWorkingCameraThatDecodes("https://app.example/verify/3f2a1c9e-89aa-4b7a-8f0a-000000000001");

    await renderScan();
    await settle();

    expect(container.textContent).toContain("Verified");
    expect(container.textContent).toContain("BAGWIS");
    // Invariant #7 carried into the UI: no legal name, member number or blood type for a
    // cross-chapter scan, even though the server call itself succeeded.
    expect(container.textContent).not.toContain("Full name");
    expect(container.textContent).not.toContain("Member no.");
    expect(container.textContent).not.toContain("Blood");
  });

  it('renders exactly "This ID is not valid." with no further detail when isValid is false', async () => {
    stubFetch([
      ["/api/scans", { status: 200, body: { isValid: false, giftName: null, chapterName: null, statusName: null, renewedThrough: null, isSameChapter: false, fullName: null, memberNumber: null, bloodTypeName: null } }],
    ]);
    stubWorkingCameraThatDecodes("https://app.example/verify/3f2a1c9e-89aa-4b7a-8f0a-000000000002");

    await renderScan();
    await settle();

    expect(container.textContent).toContain("This ID is not valid.");
    expect(container.textContent).not.toContain("Verified");
  });

  it("renders the grey 'No signal' state on a network failure — never red", async () => {
    stubRejectedFetch();
    stubWorkingCameraThatDecodes("https://app.example/verify/3f2a1c9e-89aa-4b7a-8f0a-000000000003");

    await renderScan();
    await settle();

    expect(container.textContent).toContain("Can't check right now");
    expect(container.textContent).toContain("No signal");
    expect(container.textContent).not.toContain("This ID is not valid.");
  });
});
