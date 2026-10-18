/**
 * FeatureGate: open (or still loading, or unreadable) renders the screen; closed renders the
 * kind "free trial has ended" page with a way back to Announcements — never an amount owed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { FeatureGate } from "./FeatureGate";

let container: HTMLDivElement;
let root: Root;

const LOCKED = {
  isTrialEnabled: true, trialDays: 30, trialStartedOn: "2026-08-01", trialEndsOn: "2026-08-31",
  trialDaysLeft: 0, isPaid: false, isLocked: true, membershipYear: 2026,
  features: [
    { featureKey: "Announcements", displayName: "Announcements", isOpen: true },
    { featureKey: "Meetings", displayName: "Meetings", isOpen: false },
    { featureKey: "Dashboard", displayName: "Dashboard", isOpen: true },
  ],
};

function stubFetch(access: unknown | "pending") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ memberId: 1, chapterId: 1, chapterName: "C", giftName: "TANGLAW", roles: [] }) };
    }
    if (url.includes("/api/members/me/access")) {
      if (access === "pending") return new Promise(() => { /* never resolves */ });
      return { ok: true, status: 200, json: async () => access };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function render(featureKey: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter>
            <FeatureGate featureKey={featureKey}><p>REAL SCREEN</p></FeatureGate>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

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

describe("FeatureGate", () => {
  it("renders the screen when the feature is open", async () => {
    stubFetch(LOCKED);
    await render("Dashboard");
    expect(container.textContent).toContain("REAL SCREEN");
  });

  it("renders the kind lock message, with a way to Announcements, when the feature is closed", async () => {
    stubFetch(LOCKED);
    await render("Meetings");
    expect(container.textContent).not.toContain("REAL SCREEN");
    expect(container.textContent).toContain("Your free trial has ended");
    expect(container.textContent).toContain("You can still read announcements");
    const link = Array.from(container.querySelectorAll("a")).find(a => a.getAttribute("href") === "/announcements");
    expect(link).toBeTruthy();
    // Never an amount owed (invariant #5).
    expect(container.textContent).not.toMatch(/₱|owe|arrears|overdue|unpaid/i);
  });

  it("never locks Announcements", async () => {
    stubFetch({ ...LOCKED, features: [{ featureKey: "Announcements", displayName: "Announcements", isOpen: false }] });
    await render("Announcements");
    expect(container.textContent).toContain("REAL SCREEN");
  });

  it("renders normally while access is still loading (no lock flash)", async () => {
    stubFetch("pending");
    await render("Meetings");
    expect(container.textContent).toContain("REAL SCREEN");
  });

  it("renders normally when the member is not locked", async () => {
    stubFetch({ ...LOCKED, isLocked: false, isPaid: true });
    await render("Meetings");
    expect(container.textContent).toContain("REAL SCREEN");
  });
});
