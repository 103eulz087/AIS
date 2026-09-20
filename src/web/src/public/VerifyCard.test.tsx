/**
 * /verify/:token — public, unauthenticated. Covers the four render states this screen
 * promises in its own header comment: checking (not asserted here — it's the default,
 * momentary state), verified (green), invalid (red), unavailable (grey/"No signal").
 * Same test shape as RegisterChapter.test.tsx / Applications.test.tsx — stubFetch by URL
 * substring, renderAt mounting inside MemoryRouter + QueryClientProvider, settle() to
 * flush effects.
 *
 * The one case unique to this screen: a malformed/missing :token route param must
 * short-circuit to the red state WITHOUT ever calling the API (CLAUDE.md invariant #4 —
 * there is nothing to ask the server about a token that isn't even guid-shaped).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerifyCard } from "./VerifyCard";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface FetchRule { status: number; body: unknown }

function stubFetch(rules: Array<[matchUrl: string, rule: FetchRule]>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    for (const [key, rule] of rules) {
      if (url.includes(key)) {
        return { ok: rule.status >= 200 && rule.status < 300, status: rule.status, json: async () => rule.body };
      }
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function stubRejectedFetch() {
  return vi.fn(async () => { throw new TypeError("Failed to fetch"); });
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/verify/:token" element={<VerifyCard />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const VALID_TOKEN = "3f2a1c9e-89aa-4b7a-8f0a-000000000000";

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
});

describe("VerifyCard", () => {
  it("renders the verified state with photo/gift name/chapter/status/renewed-through, and no sign-in chrome", async () => {
    vi.stubGlobal("fetch", stubFetch([
      ["/api/verifications", {
        status: 200,
        body: {
          isValid: true, giftName: "TANGLAW", chapterName: "Brgy. San Isidro Chapter",
          statusName: "Active", renewedThrough: "2027-08-08", photoUrl: null,
        },
      }],
    ]));

    await renderAt(`/verify/${VALID_TOKEN}`);

    expect(container.textContent).toContain("TANGLAW");
    expect(container.textContent).toContain("Brgy. San Isidro Chapter");
    expect(container.textContent).toContain("ACTIVE");
    expect(container.textContent).toContain("Verified");

    // No sign-in link or navigation of any kind on this page, by design.
    expect(container.textContent?.toLowerCase()).not.toContain("sign in");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
  });

  it('renders exactly "This ID is not valid." with no further detail when isValid is false', async () => {
    vi.stubGlobal("fetch", stubFetch([
      ["/api/verifications", { status: 200, body: { isValid: false, giftName: null, chapterName: null, statusName: null, renewedThrough: null, photoUrl: null } }],
    ]));

    await renderAt(`/verify/${VALID_TOKEN}`);

    expect(container.textContent).toContain("This ID is not valid.");
    // Anti-enumeration carried into the UI: nothing else about the (non-)card is shown.
    expect(container.textContent).not.toContain("Verified");
    expect(container.textContent?.toLowerCase()).not.toContain("sign in");
  });

  it("renders the grey 'Can't check right now' state on a network failure, never red", async () => {
    vi.stubGlobal("fetch", stubRejectedFetch());

    await renderAt(`/verify/${VALID_TOKEN}`);

    expect(container.textContent).toContain("Can't check right now");
    expect(container.textContent).toContain("No signal");
    expect(container.textContent).not.toContain("This ID is not valid.");
  });

  it("short-circuits a malformed token straight to the red state without ever calling the API", async () => {
    const fetchSpy = stubFetch([
      ["/api/verifications", { status: 200, body: { isValid: true, giftName: "TANGLAW", chapterName: null, statusName: null, renewedThrough: null, photoUrl: null } }],
    ]);
    vi.stubGlobal("fetch", fetchSpy);

    await renderAt("/verify/not-a-guid-at-all");

    expect(container.textContent).toContain("This ID is not valid.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
