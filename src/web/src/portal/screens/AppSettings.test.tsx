/**
 * App settings: shows the settings and the plain-words preview, Announcements is checked and
 * disabled, Save sends exactly the body the API expects, and anyone without AppSettings.Manage
 * gets a no-access state without the GET ever being sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { AppSettings } from "./AppSettings";
import type { AppSettings as AppSettingsData, CouncilSeatPermissions } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;
let putBodies: unknown[];
let getCount: number;

const SETTINGS: AppSettingsData = {
  isTrialEnabled: false, trialDays: 30, updatedByGiftName: "SANDIGAN", updatedDate: "2026-10-01T02:00:00Z",
  features: [
    { featureKey: "Announcements", displayName: "Announcements", description: "Notices from your chapter and National.", isAlwaysOpen: true, isOpenAfterTrial: true },
    { featureKey: "Meetings", displayName: "Meetings", description: "Meeting records.", isAlwaysOpen: false, isOpenAfterTrial: false },
    { featureKey: "DigitalId", displayName: "Digital ID", description: "Your ID card.", isAlwaysOpen: false, isOpenAfterTrial: true },
  ],
  preview: { totalMembers: 578, paidMembers: 28, inTrialMembers: 543, trialOverMembers: 7 },
};

function stubFetch(permissions: string[]) {
  const councilSeats: CouncilSeatPermissions[] = [
    { councilId: 1, councilName: "National Council", officeName: "President", permissions, canManagePermissions: true },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return { ok: true, status: 200, json: async () => ({ memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles: ["CouncilAdmin"], councilSeats }) };
    }
    if (url.includes("/api/app-settings")) {
      if (init?.method === "PUT") {
        putBodies.push(JSON.parse(String(init.body)));
        return { ok: true, status: 204, json: async () => { throw new Error("no body"); } };
      }
      getCount++;
      return { ok: true, status: 200, json: async () => SETTINGS };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function wait(ms: number) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider><MemoryRouter><AppSettings /></MemoryRouter></AuthProvider>
      </QueryClientProvider>,
    );
  });
  await wait(80);
}

async function click(el: Element | null | undefined) {
  await act(async () => { (el as HTMLElement).click(); });
}

beforeEach(() => {
  putBodies = [];
  getCount = 0;
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

describe("AppSettings", () => {
  it("shows a no-access state, and never calls the API, without AppSettings.Manage", async () => {
    stubFetch([]);
    await renderScreen();
    expect(container.textContent).toContain("You don't have access to this");
    expect(getCount).toBe(0);
  });

  it("shows the settings, the plain-words preview and last-updated line", async () => {
    stubFetch(["AppSettings.Manage"]);
    await renderScreen();
    const text = container.textContent ?? "";
    expect(text).toContain("App settings");
    expect(text).toContain("Free trial");
    expect(text).toContain("Of 578 members: 28 paid or free this year, 543 still in their free trial, 7 whose free trial is over");
    expect(text).toContain("Last changed");
    expect(text).toContain("SANDIGAN");
    expect(text).not.toMatch(/arrears|owe|overdue|₱/i);
  });

  it("lists Announcements as checked, disabled and always open", async () => {
    stubFetch(["AppSettings.Manage"]);
    await renderScreen();
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>("fieldset input[type=checkbox]"));
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[0]!.disabled).toBe(true);
    expect(container.textContent).toContain("Always open");
    expect(boxes[1]!.checked).toBe(false);
    expect(boxes[2]!.checked).toBe(true);
  });

  it("warns when switching on would limit members already past their trial", async () => {
    stubFetch(["AppSettings.Manage"]);
    await renderScreen();
    expect(container.querySelector("[role=alert]")).toBeNull();
    await click(container.querySelector("input[role=switch]"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("7 members");
  });

  it("saves exactly the body the API expects, then refetches", async () => {
    stubFetch(["AppSettings.Manage"]);
    await renderScreen();
    await click(container.querySelector("input[role=switch]"));
    // Open Meetings after the trial as well.
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>("fieldset input[type=checkbox]"));
    await click(boxes[1]);
    const save = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Save settings");
    await click(save);
    await wait(60);
    expect(putBodies).toEqual([{
      isTrialEnabled: true, trialDays: 30,
      openFeatureKeys: expect.arrayContaining(["Announcements", "DigitalId", "Meetings"]),
    }]);
    expect(getCount).toBeGreaterThanOrEqual(2);
  });

  it("disables Save for a number of days outside 1-365", async () => {
    stubFetch(["AppSettings.Manage"]);
    await renderScreen();
    const input = container.querySelector<HTMLInputElement>("#trial-days")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "400");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Save settings")!;
    expect(save.disabled).toBe(true);
    expect(container.textContent).toContain("from 1 to 365");
  });
});
