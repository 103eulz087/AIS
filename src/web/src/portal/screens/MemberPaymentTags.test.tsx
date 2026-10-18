/**
 * Payment tags follow the permission grid: MemberPaymentTag.Read shows the list,
 * MemberPaymentTag.Set additionally shows the Paid/Free/Unpaid buttons. A view-only user
 * gets the list, the current tag as plain text, and one plain-English note.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { MemberPaymentTags } from "./MemberPaymentTags";
import type { CouncilSeatPermissions } from "@/shared/types";

let container: HTMLDivElement;
let root: Root;

const ROW = {
  memberId: 7, giftName: "TANGLAW", fullName: "Juan Dela Cruz", memberNumber: "AKR-04-0117-001",
  chapterName: "Sta. Rosa", statusName: "Active", membershipYear: 2026,
  paymentStatus: "Unpaid", taggedByGiftName: null,
};

function stubFetch(permissions: string[]) {
  const councilSeats: CouncilSeatPermissions[] = [
    { councilId: 1, councilName: "National Council", officeName: "President", permissions, canManagePermissions: true },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 9, chapterId: 0, chapterName: null, giftName: "SANDIGAN", roles: ["CouncilAdmin"], councilSeats }),
      };
    }
    if (url.includes("/api/member-payment-tags/members")) {
      return { ok: true, status: 200, json: async () => [ROW] };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function wait(ms: number) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function renderAndSearch() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter><MemberPaymentTags /></MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await wait(60);
  const byMember = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "By member");
  if (byMember) await act(async () => { byMember.click(); });
  const input = container.querySelector("input");
  if (input) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "tanglaw");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(450);
    await wait(150);
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MemberPaymentTags — permission gating", () => {
  it("shows an access message, no search, to a seat with neither key", async () => {
    stubFetch([]);
    await renderAndSearch();
    expect(container.textContent).toContain("You don't have access to this");
    expect(container.querySelector("input")).toBeNull();
  });

  it("is read-only with a note when the seat can view but not update", async () => {
    stubFetch(["MemberPaymentTag.Read"]);
    await renderAndSearch();
    expect(container.textContent).toContain("TANGLAW");
    expect(container.textContent).toContain("Updating them needs the");
    const labels = Array.from(container.querySelectorAll("td button")).map(b => b.textContent);
    expect(labels).not.toContain("Paid");
    expect(labels).not.toContain("Free");
    expect(labels).not.toContain("Unpaid");
  });

  it("offers the Paid / Free / Unpaid buttons, and no note, when the seat can update", async () => {
    stubFetch(["MemberPaymentTag.Read", "MemberPaymentTag.Set"]);
    await renderAndSearch();
    const labels = Array.from(container.querySelectorAll("td button")).map(b => b.textContent);
    expect(labels).toEqual(["Paid", "Free", "Unpaid"]);
    expect(container.textContent).not.toContain("Updating them needs the");
  });
});
