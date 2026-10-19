/**
 * The tour engine: stepping, skipping, Esc, a missing target being dropped quietly, the
 * `when` filter, and the finish report (right body; remembered when the send fails).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TourProvider, useTour } from "./TourProvider";
import { readPending } from "./pending";
import type { TourStep } from "./types";

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let failPost = false;

const STEPS: TourStep[] = [
  { id: "welcome", title: "Welcome, TANGLAW!", body: "Hello there." },
  { id: "a", target: "a", title: "Thing A", body: "This is A." },
  { id: "gone", target: "not-on-this-page", title: "Thing Gone", body: "Never shown." },
  { id: "hidden", title: "Hidden step", body: "Filtered out.", when: () => false },
  { id: "done", title: "You're all set!", body: "Bye." },
];

function Starter({ steps = STEPS }: { steps?: TourStep[] }) {
  const tour = useTour();
  return (
    <div>
      <div data-tour="a">A</div>
      <button id="go" onClick={() => tour.start({ tourKey: "test-tour", tourVersion: 3, steps })}>go</button>
    </div>
  );
}

const tick = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === text);
const click = (el: HTMLElement | undefined | null) => act(async () => { el?.click(); });
const keydown = (key: string) => act(async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});
const postBodies = () => fetchMock.mock.calls
  .filter(c => (c[1] as RequestInit | undefined)?.method === "POST")
  .map(c => ({ url: String(c[0]), body: JSON.parse(String((c[1] as RequestInit).body)) }));

async function mount(steps?: TourStep[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><TourProvider memberId={7}><Starter steps={steps} /></TourProvider></MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await click(document.getElementById("go"));
  await tick(120);
}

beforeEach(() => {
  failPost = false;
  window.localStorage.clear();
  fetchMock = vi.fn(async () => {
    if (failPost) throw new TypeError("offline");
    return { ok: true, status: 204, json: async () => undefined };
  });
  vi.stubGlobal("fetch", fetchMock);
  // jsdom lays nothing out: give tour targets a size so they count as "on screen".
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

describe("tour engine", () => {
  it("filters steps with `when` before starting, so the count is honest", async () => {
    await mount();
    expect(dialog()?.textContent).toContain("Welcome, TANGLAW!");
    // welcome, a, gone, done -> 4 (the `when: false` step never counts)
    expect(dialog()?.textContent).toContain("Step 1 of 4");
  });

  it("is a labelled modal dialog with 44px buttons", async () => {
    await mount();
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    const labelId = d.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)?.textContent).toBe("Welcome, TANGLAW!");
    expect(buttonByText("Skip tour")).toBeTruthy();
    expect(buttonByText("Back")).toBeFalsy();           // nothing to go back to on step 1
    expect(buttonByText("Next")!.style.minHeight).toBe("44px");
  });

  it("moves next and back", async () => {
    await mount();
    await click(buttonByText("Next"));
    await tick(120);
    expect(dialog()?.textContent).toContain("Thing A");
    expect(dialog()?.textContent).toContain("Step 2 of 4");
    await click(buttonByText("Back"));
    await tick(120);
    expect(dialog()?.textContent).toContain("Welcome, TANGLAW!");
  });

  it("arrow keys move through the steps", async () => {
    await mount();
    await keydown("ArrowRight");
    await tick(120);
    expect(dialog()?.textContent).toContain("Thing A");
    await keydown("ArrowLeft");
    await tick(120);
    expect(dialog()?.textContent).toContain("Welcome, TANGLAW!");
  });

  it("drops a step whose target never appears, without a fuss", async () => {
    await mount();
    await click(buttonByText("Next"));
    await tick(120);
    await click(buttonByText("Next"));        // -> the missing-target step
    await tick(1800);                         // wait out the ~1.5s allowance
    expect(dialog()?.textContent).not.toContain("Thing Gone");
    expect(dialog()?.textContent).toContain("You're all set!");
    expect(dialog()?.textContent).toContain("Step 3 of 3");
  });

  it("Finish reports Completed with the tour version", async () => {
    await mount([STEPS[0]!, STEPS[4]!]);
    await click(buttonByText("Next"));
    await tick(120);
    expect(buttonByText("Finish")).toBeTruthy();
    expect(buttonByText("Skip tour")).toBeFalsy();
    await click(buttonByText("Finish"));
    await tick(50);
    expect(dialog()).toBeNull();
    expect(postBodies()).toEqual([{
      url: "/api/members/me/tutorials/test-tour/finish",
      body: { tourVersion: 3, outcome: "Completed" },
    }]);
    expect(readPending()).toEqual([]);        // delivered, so nothing left to retry
  });

  it("Skip tour reports Skipped", async () => {
    await mount();
    await click(buttonByText("Skip tour"));
    await tick(50);
    expect(dialog()).toBeNull();
    expect(postBodies()[0]?.body).toEqual({ tourVersion: 3, outcome: "Skipped" });
  });

  it("Esc skips", async () => {
    await mount();
    await keydown("Escape");
    await tick(50);
    expect(dialog()).toBeNull();
    expect(postBodies()[0]?.body).toEqual({ tourVersion: 3, outcome: "Skipped" });
  });

  it("remembers a report that could not be sent, and sends it on the next load", async () => {
    failPost = true;
    await mount();
    await keydown("Escape");
    await tick(50);
    expect(readPending()).toEqual([{ memberId: 7, tourKey: "test-tour", tourVersion: 3, outcome: "Skipped" }]);

    failPost = false;
    fetchMock.mockClear();
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await mount();                            // a fresh load: the provider retries what is pending
    expect(postBodies().some(p => p.body.outcome === "Skipped")).toBe(true);
    expect(readPending()).toEqual([]);
  });

  it("keeps focus inside the card when Tab is pressed", async () => {
    await mount();
    const card = dialog()!;
    expect(card.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.body.focus();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it("does nothing and does not throw when started with no usable steps", async () => {
    await mount([{ id: "x", title: "x", body: "x", when: () => false }]);
    expect(dialog()).toBeNull();
  });
});
