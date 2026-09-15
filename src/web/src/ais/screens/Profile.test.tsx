/**
 * Member self-service profile. Covers: the read-only "Your record" block never
 * renders an editable control, the blood-type confirm requires a genuinely separate
 * deliberate action and is never described as "verified", the mobile-number password
 * step-up only appears once the number actually changes, a rejected mobile-number save
 * keeps the member's other edits intact, and a 409 conflict shows its own message with
 * a Refresh action rather than the generic error state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { Profile } from "./Profile";

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

interface PatchResult { status: number; body: unknown }

/**
 * Stubs auth (as a plain Member) plus GET/PATCH /api/members/me and the two reference
 * lists. GET /api/members/me is stateful: each call consumes the next fixture in
 * `profileQueue` (the last one repeats), so a test can assert what the screen shows
 * after its own explicit refetch-on-save without a second stubFetch call.
 */
function stubFetch(opts: {
  profileQueue: unknown[];
  patch?: (body: Record<string, unknown>) => PatchResult;
  bloodTypes?: unknown;
  skills?: unknown;
}) {
  let profileCallIndex = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "BAGWIS", roles: ["Member"] }),
      };
    }
    if (url.includes("/api/blood-types")) {
      return { ok: true, status: 200, json: async () => opts.bloodTypes ?? [] };
    }
    if (url.includes("/api/skills")) {
      return { ok: true, status: 200, json: async () => opts.skills ?? [] };
    }
    if (url.includes("/api/members/me") && method === "GET") {
      const idx = Math.min(profileCallIndex, opts.profileQueue.length - 1);
      profileCallIndex += 1;
      return { ok: true, status: 200, json: async () => opts.profileQueue[idx] };
    }
    if (url.includes("/api/members/me") && method === "PATCH") {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const result = opts.patch ? opts.patch(body) : { status: 200, body: { rowVersion: "next" } };
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderProfile() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/profile"]}>
            <Routes><Route path="/profile" element={<Profile />} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

// Same jsdom workaround Applications.test.tsx uses: go through the native value setter
// before dispatching the input event, so React's own onChange actually fires.
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

const BASE_PROFILE = {
  memberId: 1, memberNumber: "AKR-04-0117-002",
  firstName: "Juan", middleName: "Dela", lastName: "Cruz", giftName: "BAGWIS",
  birthdate: "1990-05-01", dateSurvive: "2010-08-09",
  presidentDuringSurvive: "Bro. TANGLAW", masterInitiatorDuringSurvive: "Bro. HIMAGSIK",
  chapterId: 1, chapterName: "Test Chapter", homeCouncilId: null, councilName: null,
  chapterOfRecord: "Test Chapter", status: "Active", renewedThrough: "2026-08-08",
  seconderMemberId: null, approvedBy: null, approvedDateUtc: null,
  address: "123 Sample St.", mobileNo: "09171112222", email: "bagwis@example.com",
  bloodTypeId: 1, bloodTypeName: "O+", bloodTypeConfirmedDateUtc: null,
  profession: "Driver", photoUrl: null, skillIds: [1], rowVersion: "AAAAAAAAAAE=",
};

const BLOOD_TYPES = [{ bloodTypeId: 1, bloodTypeName: "O+" }, { bloodTypeId: 2, bloodTypeName: "A+" }];
const SKILLS = [{ skillId: 1, skillName: "Driving" }, { skillId: 2, skillName: "Carpentry" }];

describe("the read-only record block", () => {
  it("renders no input, select or textarea elements", async () => {
    stubFetch({ profileQueue: [BASE_PROFILE], bloodTypes: BLOOD_TYPES, skills: SKILLS });
    await renderProfile();

    const block = container.querySelector('[data-testid="profile-readonly"]');
    expect(block).toBeTruthy();
    expect(block!.querySelectorAll("input,select,textarea").length).toBe(0);
    expect(block!.textContent).toContain(BASE_PROFILE.memberNumber);
  });
});

describe("blood type confirmation", () => {
  it("is never described as verified, and is not shown as confirmed until the explicit confirm action is taken", async () => {
    const confirmedProfile = { ...BASE_PROFILE, bloodTypeConfirmedDateUtc: "2026-09-10T00:00:00Z" };
    stubFetch({
      profileQueue: [BASE_PROFILE, confirmedProfile],
      patch: () => ({ status: 200, body: { rowVersion: "v2" } }),
      bloodTypes: BLOOD_TYPES, skills: SKILLS,
    });
    await renderProfile();

    expect(container.textContent).not.toContain("self-reported");
    expect((container.textContent ?? "").toLowerCase()).not.toContain("verified");

    const confirmCheckbox = container.querySelector('[data-testid="blood-type-confirm"]') as HTMLInputElement;
    await act(async () => { confirmCheckbox.click(); });
    await settle();
    expect(confirmCheckbox.checked).toBe(true);

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain("Self-reported, confirmed");
    expect((container.textContent ?? "").toLowerCase()).not.toContain("verified");
  });
});

describe("mobile number password step-up", () => {
  it("reveals the password field only once the number actually changes", async () => {
    stubFetch({ profileQueue: [BASE_PROFILE], bloodTypes: BLOOD_TYPES, skills: SKILLS });
    await renderProfile();

    expect(container.querySelector("#currentPassword")).toBeNull();

    const mobileInput = container.querySelector("#mobileNo") as HTMLInputElement;

    // Re-typing the same value that was loaded must not reveal the password field.
    await act(async () => { setInputValue(mobileInput, BASE_PROFILE.mobileNo); });
    await settle();
    expect(container.querySelector("#currentPassword")).toBeNull();

    await act(async () => { setInputValue(mobileInput, "09991234567"); });
    await settle();
    expect(container.querySelector("#currentPassword")).toBeTruthy();
  });

  it("shows the server's own message and keeps the member's other edits when saved with no password", async () => {
    stubFetch({
      profileQueue: [BASE_PROFILE],
      patch: body => body.currentPassword
        ? { status: 200, body: { rowVersion: "v2" } }
        : { status: 400, body: { title: "Enter your current password to change your mobile number." } },
      bloodTypes: BLOOD_TYPES, skills: SKILLS,
    });
    await renderProfile();

    const professionInput = container.querySelector("#profession") as HTMLInputElement;
    await act(async () => { setInputValue(professionInput, "Electrician"); });

    const mobileInput = container.querySelector("#mobileNo") as HTMLInputElement;
    await act(async () => { setInputValue(mobileInput, "09991234567"); });
    await settle();

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain("Enter your current password to change your mobile number.");
    expect(professionInput.value).toBe("Electrician");
    expect(mobileInput.value).toBe("09991234567");
  });
});

describe("a stale profile (409)", () => {
  it("renders the specific conflict message with a Refresh action, not the generic error state", async () => {
    stubFetch({
      profileQueue: [BASE_PROFILE, BASE_PROFILE],
      patch: () => ({ status: 409, body: { title: "This profile changed since you loaded it. Refresh and try again." } }),
      bloodTypes: BLOOD_TYPES, skills: SKILLS,
    });
    await renderProfile();

    const professionInput = container.querySelector("#profession") as HTMLInputElement;
    await act(async () => { setInputValue(professionInput, "Electrician"); });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(container.textContent).toContain("This profile changed since you loaded it. Refresh and try again.");
    expect(container.textContent).not.toContain("Something went wrong");
    const refreshButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Refresh");
    expect(refreshButton).toBeTruthy();
  });
});
