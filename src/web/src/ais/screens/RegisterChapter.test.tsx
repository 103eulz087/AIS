/**
 * The public chapter charter petition (§7A.4, decision D) — no chapter exists yet, so
 * there is no chapter mark anywhere on this screen (§7A.3): the only mark shown is the
 * live monogram preview the petitioner is building for his own soon-to-exist chapter.
 * Same test shape as Applications.test.tsx's own "Apply" suite — mirrored deliberately.
 *
 * Covers: no chapter mark/logo image anywhere; required-field validation fires
 * client-side before any submission round trip; the server-fetched Region -> Province ->
 * City/Municipality cascade actually cascades and clears a child selection when its
 * parent changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegisterChapter } from "./RegisterChapter";
import type { MunicipalityOption, ProvinceOption, RegionOption } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface FetchRule { status: number; body: unknown }

/** GET-only stub — this screen's own fetches (/api/regions, /api/provinces?regionId=,
 * /api/municipalities?provinceId=) are all public/unauthenticated, so there is no
 * auth/me or refresh handshake to stub here, unlike the authenticated screens. */
function stubFetch(rules: Array<[matchUrl: string, rule: FetchRule]>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    for (const [key, rule] of rules) {
      if (url.includes(key)) {
        return { ok: rule.status >= 200 && rule.status < 300, status: rule.status, json: async () => rule.body };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderAt(path: string, routePath: string, element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={routePath} element={element} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

// Same jsdom controlled-input workaround Applications.test.tsx uses — see that file's own
// comment on why `.value =` alone does not fire React's onChange.
function setSelectValue(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
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

const REGIONS: RegionOption[] = [
  { regionId: 4, regionCode: "04", regionName: "Region IV-A CALABARZON" },
  { regionId: 3, regionCode: "03", regionName: "Region III Central Luzon" },
];

const PROVINCES_FOR_REGION_4: ProvinceOption[] = [
  { provinceId: 41, regionId: 4, provinceCode: 1, provinceName: "Laguna Provincial Council" },
];

const MUNICIPALITIES_FOR_PROVINCE_41: MunicipalityOption[] = [
  { municipalityId: 411, provinceId: 41, municipalityCode: 1, municipalityName: "Sta. Rosa City Council", zipCode: null },
  { municipalityId: 412, provinceId: 41, municipalityCode: 2, municipalityName: "Calamba City Council", zipCode: null },
];

describe("RegisterChapter", () => {
  it("renders with no chapter mark/logo image anywhere", async () => {
    stubFetch([["/api/regions", { status: 200, body: REGIONS }]]);
    await renderAt("/register-chapter", "/register-chapter", <RegisterChapter />);

    expect(container.textContent).toContain("Register a new chapter");
    // The live monogram preview is a role="img" DIV (ChapterMonogram.tsx), never a real
    // <img> tag — there is no logo upload anywhere in this module, and no chapter mark
    // exists before a chapter does (§7A.3).
    expect(container.querySelector("img")).toBeNull();
  });

  it("fires client-side required-field validation before any submission round trip", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/api/regions")) return { ok: true, status: 200, json: async () => REGIONS };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    await renderAt("/register-chapter", "/register-chapter", <RegisterChapter />);

    // Nothing filled in at all — submit the first step immediately.
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain("Enter the proposed chapter name.");

    // Still on step 1 — no POST to /api/chapter-registrations was ever attempted.
    const postedRegistration = fetchSpy.mock.calls.some(([input]) => requestUrl(input as RequestInfo | URL).includes("/api/chapter-registrations"));
    expect(postedRegistration).toBe(false);
  });

  it("cascades Region -> Province -> City/Municipality, clearing a child when its parent changes", async () => {
    stubFetch([
      ["/api/regions", { status: 200, body: REGIONS }],
      ["/api/provinces?regionId=4", { status: 200, body: PROVINCES_FOR_REGION_4 }],
      ["/api/provinces?regionId=3", { status: 200, body: [] }],
      ["/api/municipalities?provinceId=41", { status: 200, body: MUNICIPALITIES_FOR_PROVINCE_41 }],
    ]);
    await renderAt("/register-chapter", "/register-chapter", <RegisterChapter />);

    const region = container.querySelector("#region") as HTMLSelectElement;
    const province = container.querySelector("#province") as HTMLSelectElement;
    const municipality = container.querySelector("#municipality") as HTMLSelectElement;

    // Nothing downstream is enabled yet.
    expect(province.disabled).toBe(true);
    expect(municipality.disabled).toBe(true);

    await act(async () => { setSelectValue(region, "4"); });
    await settle();
    expect(province.disabled).toBe(false);
    expect(Array.from(province.options).map(o => o.textContent)).toEqual(
      expect.arrayContaining(["Laguna Provincial Council"]),
    );

    await act(async () => { setSelectValue(province, "41"); });
    await settle();
    expect(municipality.disabled).toBe(false);
    expect(Array.from(municipality.options).map(o => o.textContent)).toEqual(
      expect.arrayContaining(["Sta. Rosa City Council", "Calamba City Council"]),
    );

    await act(async () => { setSelectValue(municipality, "411"); });
    await settle();
    expect(municipality.value).toBe("411");

    // Changing the region clears BOTH province and municipality — the child selections
    // no longer mean anything once the parent changes.
    await act(async () => { setSelectValue(region, "3"); });
    await settle();
    expect(province.value).toBe("");
    expect(municipality.value).toBe("");
    expect(municipality.disabled).toBe(true);
  });

  it("blocks moving to the officer roster step until the chapter name and full geography are chosen", async () => {
    stubFetch([
      ["/api/regions", { status: 200, body: REGIONS }],
      ["/api/provinces?regionId=4", { status: 200, body: PROVINCES_FOR_REGION_4 }],
      ["/api/municipalities?provinceId=41", { status: 200, body: MUNICIPALITIES_FOR_PROVINCE_41 }],
    ]);
    await renderAt("/register-chapter", "/register-chapter", <RegisterChapter />);

    const chapterName = container.querySelector("#chapterName") as HTMLInputElement;
    await act(async () => { setInputValue(chapterName, "Brgy. Test Chapter"); });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain("Choose the chapter's region, province and city/municipality.");
    // Still step 1 — the officer roster fields never appeared.
    expect(container.querySelector("#officer-1-firstName")).toBeNull();
  });
});
