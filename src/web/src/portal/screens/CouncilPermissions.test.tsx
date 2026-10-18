/**
 * Phase 1 "dynamic council office permissions" (2026-10-17). Covers: the President's
 * card never offers a toggle and always reads as fixed; the Auditor's write-permission
 * cells render disabled with the server's own lock reason; a caller who can only VIEW
 * the grid (header.canEdit=false) gets no Save control at all; a save PUTs only the
 * cells that actually changed, never the whole grid; and the client-side mirror of the
 * "requires Review" rule cascades both directions before any PUT is ever sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { CouncilPermissions } from "./CouncilPermissions";
import type {
  CouncilPermissionCell, CouncilPermissionGrid, CouncilPermissionKey, CouncilPermissionOffice,
} from "@/shared/types";

let container: HTMLDivElement;
let root: Root;
let putCalls: Array<{ url: string; body: unknown }>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const OFFICES: CouncilPermissionOffice[] = [
  { id: 1, name: "President", isPresiding: true, isReadOnly: false },
  { id: 3, name: "Secretary", isPresiding: false, isReadOnly: false },
  { id: 5, name: "Auditor", isPresiding: false, isReadOnly: true },
];

const PERMISSIONS: CouncilPermissionKey[] = [
  { permissionKey: "ChapterRegistration.Review", displayName: "Review chapter registrations", description: "See the chapter registrations this council is responsible for deciding.", isWrite: false, isNationalOnly: false, requiresKey: null, sortOrder: 10 },
  { permissionKey: "ChapterRegistration.Verify", displayName: "Verify officers on a registration", description: "Tick off each officer named on a chapter registration as verified.", isWrite: true, isNationalOnly: false, requiresKey: "ChapterRegistration.Review", sortOrder: 20 },
  { permissionKey: "ChapterRegistration.Approve", displayName: "Approve a chapter registration", description: "Give the final approval once every officer has been verified.", isWrite: true, isNationalOnly: false, requiresKey: "ChapterRegistration.Review", sortOrder: 30 },
  { permissionKey: "ChapterRegistration.Return", displayName: "Return a registration for correction", description: "Send a registration back to the chapter with a reason, instead of approving it.", isWrite: true, isNationalOnly: false, requiresKey: "ChapterRegistration.Review", sortOrder: 40 },
  { permissionKey: "CouncilStatistics.Read", displayName: "View council statistics", description: "See the rollup of councils, chapters, and members under this council.", isWrite: false, isNationalOnly: false, requiresKey: null, sortOrder: 50 },
  { permissionKey: "CouncilMemberSearch.Read", displayName: "Search members", description: "Search for any member under this council's jurisdiction, with full contact detail.", isWrite: false, isNationalOnly: false, requiresKey: null, sortOrder: 60 },
];

function cell(councilOfficeId: number, permissionKey: string, isGranted: boolean, isLocked = false, lockReason: string | null = null): CouncilPermissionCell {
  return { councilOfficeId, permissionKey, isGranted, isDefault: true, isLocked, lockReason };
}

/** secretaryAllGranted: true -> Secretary holds all six keys (used for the cascade-OFF
 * scenario); false -> Secretary holds none of them (used for the cascade-ON scenario). */
function buildGrid(canEdit: boolean, secretaryAllGranted: boolean): CouncilPermissionGrid {
  const cells: CouncilPermissionCell[] = [
    ...PERMISSIONS.map(p => cell(1, p.permissionKey, true, true, "The President's permissions are fixed.")),
    ...PERMISSIONS.map(p => cell(3, p.permissionKey, secretaryAllGranted)),
    cell(5, "ChapterRegistration.Review", false),
    cell(5, "ChapterRegistration.Verify", false, true, "This office is read-only and cannot hold a write permission."),
    cell(5, "ChapterRegistration.Approve", false, true, "This office is read-only and cannot hold a write permission."),
    cell(5, "ChapterRegistration.Return", false, true, "This office is read-only and cannot hold a write permission."),
    cell(5, "CouncilStatistics.Read", false),
    cell(5, "CouncilMemberSearch.Read", false),
  ];
  return {
    header: { councilId: 10, councilName: "Sta. Rosa City Council", isNational: false, canEdit },
    offices: OFFICES, permissions: PERMISSIONS, cells, history: [],
  };
}

function stubFetch(grid: CouncilPermissionGrid, canEdit: boolean) {
  putCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles: ["CouncilSecretary"],
          councilSeats: [{
            councilId: 10, councilName: "Sta. Rosa City Council", officeName: "Secretary",
            canManagePermissions: canEdit, permissions: PERMISSIONS.map(p => p.permissionKey),
          }],
        }),
      };
    }
    if (method === "GET" && url.includes("/api/councils/10/permissions")) {
      return { ok: true, status: 200, json: async () => grid };
    }
    if (method === "PUT" && url.includes("/api/councils/10/permissions")) {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : null;
      putCalls.push({ url, body });
      return { ok: true, status: 200, json: async () => ({ changedCount: (body as { changes: unknown[] }).changes.length }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
}

async function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/portal/council-permissions"]}>
            <Routes><Route path="/portal/council-permissions" element={<CouncilPermissions />} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function checkbox(label: string): HTMLInputElement {
  const el = container.querySelector(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`No checkbox found for aria-label "${label}"`);
  return el as HTMLInputElement;
}

function clickButton(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.startsWith(text));
  if (!btn) throw new Error(`No button found starting with "${text}"`);
  act(() => { btn.click(); });
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

describe("CouncilPermissions — the President's card", () => {
  it("never offers a toggle, and reads as fixed", async () => {
    stubFetch(buildGrid(true, true), true);
    await renderScreen();

    expect(container.textContent).toContain("The President always has every permission below. This cannot be changed.");
    expect(() => checkbox("President — Review chapter registrations")).toThrow();
  });
});

describe("CouncilPermissions — the Auditor's locked write cells", () => {
  it("renders Verify/Approve/Return disabled with the server's own lock reason", async () => {
    stubFetch(buildGrid(true, true), true);
    await renderScreen();

    const verify = checkbox("Auditor — Verify officers on a registration");
    const approve = checkbox("Auditor — Approve a chapter registration");
    const ret = checkbox("Auditor — Return a registration for correction");
    expect(verify.disabled).toBe(true);
    expect(approve.disabled).toBe(true);
    expect(ret.disabled).toBe(true);
    expect(container.textContent).toContain("This office is read-only and cannot hold a write permission.");

    // The Auditor's READ-only keys are still ordinary, unlocked toggles.
    const review = checkbox("Auditor — Review chapter registrations");
    expect(review.disabled).toBe(false);
  });
});

describe("CouncilPermissions — read-only view", () => {
  it("shows no Save control when header.canEdit is false, and disables every toggle", async () => {
    stubFetch(buildGrid(false, true), false);
    await renderScreen();

    expect(container.textContent).toContain("only Sta. Rosa City Council's own President can change them");
    const secretaryReview = checkbox("Secretary — Review chapter registrations");
    expect(secretaryReview.disabled).toBe(true);

    const saveButton = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.startsWith("Save changes"));
    expect(saveButton).toBeUndefined();
  });
});

describe("CouncilPermissions — save sends only the changed cells", () => {
  it("PUTs a single change for a single toggle, not the whole grid", async () => {
    stubFetch(buildGrid(true, true), true);
    await renderScreen();

    const memberSearch = checkbox("Secretary — Search members");
    act(() => { memberSearch.click(); });
    await settle();

    clickButton("Save changes");
    await settle();
    clickButton("Confirm and save");
    await settle();

    expect(putCalls).toHaveLength(1);
    const call = putCalls[0];
    if (!call) throw new Error("expected one PUT call");
    const body = call.body as { changes: Array<{ councilOfficeId: number; permissionKey: string; isGranted: boolean }>; reason: string | null };
    expect(body.changes).toEqual([{ councilOfficeId: 3, permissionKey: "CouncilMemberSearch.Read", isGranted: false }]);
    expect(body.reason).toBeNull();
  });
});

describe("CouncilPermissions — the Review dependency, mirrored client-side", () => {
  it("turning Review off for an office also turns off its Verify/Approve/Return before saving", async () => {
    stubFetch(buildGrid(true, true), true);
    await renderScreen();

    const review = checkbox("Secretary — Review chapter registrations");
    act(() => { review.click(); });
    await settle();

    clickButton("Save changes");
    await settle();

    expect(container.textContent).toContain("4 changes to save");
    const verify = checkbox("Secretary — Verify officers on a registration");
    const approve = checkbox("Secretary — Approve a chapter registration");
    const ret = checkbox("Secretary — Return a registration for correction");
    expect(verify.checked).toBe(false);
    expect(approve.checked).toBe(false);
    expect(ret.checked).toBe(false);
  });

  it("turning a dependent on also turns Review on first", async () => {
    stubFetch(buildGrid(true, false), true);
    await renderScreen();

    const verify = checkbox("Secretary — Verify officers on a registration");
    expect(verify.checked).toBe(false);
    act(() => { verify.click(); });
    await settle();

    const review = checkbox("Secretary — Review chapter registrations");
    expect(review.checked).toBe(true);
    expect(verify.checked).toBe(true);

    clickButton("Save changes");
    await settle();
    expect(container.textContent).toContain("2 changes to save");
  });
});
