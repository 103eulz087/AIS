/**
 * How-to guide support in the tour engine: pictures and tips on a step, route functions
 * (null drops the step), longer waits, going back to where the guide started, and nothing
 * being submittable while a guide runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TourProvider, useTour } from "./TourProvider";
import type { GuideContext, TourStep } from "./types";

let container: HTMLDivElement;
let root: Root;

const CTX: GuideContext = { claims: null, roles: [], seats: [], isFeatureOpen: () => true };

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

let submitted = 0;

function Page({ steps, returnToStart }: { steps: TourStep[]; returnToStart: boolean }) {
  const tour = useTour();
  return (
    <div>
      <Where />
      <form onSubmit={e => { e.preventDefault(); submitted++; }}><input name="x" /></form>
      <button id="go" onClick={() => tour.start({ tourKey: "guide-test", tourVersion: 1, steps, ctx: CTX, returnToStart })}>go</button>
    </div>
  );
}

const tick = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const where = () => container.querySelector('[data-testid="where"]')?.textContent;
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === text);
const click = (el: HTMLElement | undefined | null) => act(async () => { el?.click(); });

async function mount(steps: TourStep[], returnToStart = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/help"]}>
          <TourProvider memberId={7}>
            <Routes><Route path="*" element={<Page steps={steps} returnToStart={returnToStart} />} /></Routes>
          </TourProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  // A screen that finishes loading ~2s after the guide starts (added straight to the DOM, so no act() flush hides it).
  const started = Date.now();
  window.setTimeout(() => {
    if (!container.isConnected) return;
    const el = document.createElement("div");
    el.setAttribute("data-tour", "late");
    container.appendChild(el);
  }, 2000 - (Date.now() - started));
  await click(document.getElementById("go"));
  await tick(120);
}

beforeEach(() => {
  submitted = 0;
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 204, json: async () => undefined })));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const sized = this.hasAttribute("data-tour");
    return { left: 20, top: 30, width: sized ? 100 : 0, height: sized ? 40 : 0, right: 120, bottom: 70, x: 20, y: 30, toJSON: () => ({}) } as DOMRect;
  });
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

describe("guide steps", () => {
  it("shows a step's illustration and its tip", async () => {
    await mount([
      { id: "a", title: "With a picture", body: "Look.", illustration: <span data-testid="pic">pic</span>, tip: "Take your time." },
    ]);
    const d = dialog()!;
    expect(d.querySelector('[data-testid="pic"]')).toBeTruthy();
    expect(d.querySelector('[data-testid="tour-illustration"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(d.textContent).toContain("Tip:");
    expect(d.textContent).toContain("Take your time.");
  });

  it("drops a step whose route function returns null, and counts honestly", async () => {
    await mount([
      { id: "a", title: "First", body: "." },
      { id: "b", title: "Skipped", body: ".", route: () => null },
      { id: "c", title: "Third", body: "." },
    ]);
    await click(buttonByText("Next"));
    await tick(120);
    expect(dialog()?.textContent).toContain("Third");
    expect(dialog()?.textContent).not.toContain("Skipped");
    expect(dialog()?.textContent).toContain("Step 2 of 2");
  });

  it("resolves a route function (even an async one) and goes there", async () => {
    await mount([
      { id: "a", title: "First", body: "." },
      { id: "b", title: "There", body: ".", route: async () => "/meetings/9", target: "late", waitMs: 4000 },
    ]);
    await click(buttonByText("Next"));
    await tick(150);
    expect(where()).toBe("/meetings/9");
  });

  it("drops a step whose target never appears within the default wait", async () => {
    await mount([
      { id: "a", title: "First", body: "." },
      { id: "b", title: "Slow", body: ".", target: "never-here" },
      { id: "c", title: "Last", body: "." },
    ]);
    await click(buttonByText("Next"));
    await tick(1800);
    expect(dialog()?.textContent).toContain("Last");
    expect(dialog()?.textContent).not.toContain("Slow");
  }, 10_000);

  it("waits longer when the step asks for it (waitMs)", async () => {
    await mount([
      { id: "a", title: "First", body: "." },
      { id: "b", title: "Slow data", body: ".", target: "late", waitMs: 5000 },
      { id: "c", title: "Last", body: "." },
    ]);
    await click(buttonByText("Next"));
    await tick(2600);
    expect(dialog()?.textContent).toContain("Slow data");
  }, 10_000);

  it("takes the person back to where the guide started when it ends", async () => {
    await mount([
      { id: "a", title: "First", body: ".", route: "/somewhere-else" },
      { id: "b", title: "Last", body: "." },
    ]);
    expect(where()).toBe("/somewhere-else");
    await click(buttonByText("Next"));
    await click(buttonByText("Finish"));
    await tick(80);
    expect(where()).toBe("/help");
  });

  it("also goes back when the guide is skipped", async () => {
    await mount([
      { id: "a", title: "First", body: ".", route: "/somewhere-else" },
      { id: "b", title: "Last", body: "." },
    ]);
    await click(buttonByText("Skip tour"));
    await tick(80);
    expect(where()).toBe("/help");
  });

  it("stays put when the tour did not ask to return (the welcome tours)", async () => {
    await mount([
      { id: "a", title: "First", body: ".", route: "/somewhere-else" },
      { id: "b", title: "Last", body: "." },
    ], false);
    await click(buttonByText("Skip tour"));
    await tick(80);
    expect(where()).toBe("/somewhere-else");
  });

  it("cannot submit a form while a guide is running", async () => {
    await mount([{ id: "a", title: "First", body: "." }]);
    const form = container.querySelector("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(submitted).toBe(0);
    // And once it is over, the form works again.
    await click(buttonByText("Finish"));
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(submitted).toBe(1);
  });
});
