/**
 * The Digital ID must never show an out-of-date payment status (2026-10-27: a member tagged
 * Paid kept seeing "NOT YET PAID"). It asks the server every time it opens, and the Refresh
 * button re-checks on demand — swipe-down does not exist inside the installed app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DigitalId } from "./DigitalId";
import type { MyCredential } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;
let paid = false;
let credentialCalls = 0;

const credential = (): MyCredential => ({
  giftName: "WAKIN", fullName: "Arrjay Desamparado", memberNumber: "AKR-09-0116-001",
  chapterName: "KAPPA GAMMA", chapterCode: "KG", nationalCouncilName: "National Council",
  regionName: null, provinceName: null, cityName: null, dateSurvive: null, bloodTypeName: null,
  statusName: "Active", renewedThrough: null,
  credentialIssuedDateUtc: "2026-10-22T04:31:20Z", credentialExpiryDateUtc: "2027-10-22T04:31:20Z",
  verificationUrl: "/verify/abc", officePosition: null, officeBody: null,
  isPaid: paid, chapterLogoUrl: null, chapterMarkAccentHex: null,
});

beforeEach(() => {
  paid = false;
  credentialCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/members/me/credential")) {
      credentialCalls++;
      return { ok: true, status: 200, json: async () => credential() };
    }
    return { ok: true, status: 200, json: async () => ({}), blob: async () => new Blob() };
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })) {
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><MemoryRouter><DigitalId /></MemoryRouter></QueryClientProvider>);
  });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
  return qc;
}

const watermark = () => (container.textContent ?? "").includes("NOT YET PAID");
const refreshButton = () => Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Refresh")!;

describe("DigitalId stays current", () => {
  it("Refresh re-checks and drops the NOT YET PAID watermark once he is tagged Paid", async () => {
    await render();
    expect(watermark()).toBe(true);
    expect(container.textContent).toContain("Updated");

    paid = true;
    await act(async () => { refreshButton().click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    expect(watermark()).toBe(false);
    expect(credentialCalls).toBe(2);
  });

  it("asks the server again every time the screen opens, even with a fresh cached copy", async () => {
    const qc = await render();
    expect(credentialCalls).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);
    paid = true;
    await render(qc);   // same app-wide cache (30s app default staleTime), screen opened again
    expect(credentialCalls).toBe(2);
    expect(watermark()).toBe(false);
  });
});
