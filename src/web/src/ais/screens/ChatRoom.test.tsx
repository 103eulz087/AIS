/**
 * ChatRoom — the four render states (loading/error/empty/loaded), the connection
 * banner for anything other than "live", the offline-disabled composer, a removed
 * message rendering as a tombstone (never silently vanishing), and a posted message
 * appearing only from the server's own response — never optimistically before that.
 *
 * @microsoft/signalr is mocked at the module level (vi.mock below) so this file never
 * opens a real WebSocket inside jsdom — same reasoning as smoke.test.tsx's own mock,
 * with hooks (hub.instances / hub.startShouldReject) this file uses to simulate
 * reconnecting/offline without a real network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/shared/auth";
import { ChatRoom } from "./ChatRoom";
import type { ChatMessage } from "@/shared/types";

type Handler = (...args: unknown[]) => void;

// React installs its own "value" property descriptor on a controlled input/textarea
// instance; setting `.value =` directly goes through that wrapper, so the input event
// that follows looks like a no-op to React and onChange never fires. Going through the
// underlying prototype's native setter first, then dispatching the event, is the same
// workaround Applications.test.tsx/Profile.test.tsx already use in this codebase.
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const hub = vi.hoisted(() => ({
  startShouldReject: false,
  instances: [] as Array<{
    listeners: Map<string, Handler[]>;
    onreconnectingCb?: Handler;
    onreconnectedCb?: Handler;
    oncloseCb?: Handler;
  }>,
}));

vi.mock("@microsoft/signalr", () => {
  class FakeHubConnection {
    listeners = new Map<string, Handler[]>();
    onreconnectingCb?: Handler;
    onreconnectedCb?: Handler;
    oncloseCb?: Handler;

    constructor() { hub.instances.push(this); }

    on(event: string, cb: Handler) {
      const list = this.listeners.get(event) ?? [];
      list.push(cb);
      this.listeners.set(event, list);
    }
    off(event: string, cb: Handler) {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter(h => h !== cb));
    }
    onreconnecting(cb: Handler) { this.onreconnectingCb = cb; }
    onreconnected(cb: Handler) { this.onreconnectedCb = cb; }
    onclose(cb: Handler) { this.oncloseCb = cb; }
    start() { return hub.startShouldReject ? Promise.reject(new Error("no connection")) : Promise.resolve(); }
    stop() { return Promise.resolve(); }
  }
  class FakeHubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeHubConnection(); }
  }
  return { HubConnectionBuilder: FakeHubConnectionBuilder, LogLevel: { None: 0 } };
});

let container: HTMLDivElement;
let root: Root;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Stubs auth plus the chat endpoints this screen calls. `messages` defaults to a
 * resolvable empty page; pass `messagesFail: true` to exercise the error state. */
function stubFetch(opts: {
  roles?: string[]; messages?: ChatMessage[]; messagesFail?: boolean; roomFail?: boolean;
}) {
  const { roles = ["Member"], messages = [], messagesFail = false, roomFail = false } = opts;
  const calls: Array<{ method: string; url: string; body?: string }> = [];

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url.includes("/api/auth/refresh")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
    }
    if (url.includes("/api/auth/me")) {
      return {
        ok: true, status: 200,
        json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test Chapter", giftName: "TANGLAW", roles }),
      };
    }
    if (url.includes("/chat/room")) {
      if (roomFail) return { ok: false, status: 500, json: async () => ({ title: "Something went wrong." }) };
      return { ok: true, status: 200, json: async () => ({ roomId: 1, chapterId: 1, roomName: "General", retentionMonths: 12, wasCreated: false }) };
    }
    if (method === "GET" && url.includes("/chat/messages")) {
      if (messagesFail) return { ok: false, status: 500, json: async () => ({ title: "That did not load." }) };
      return { ok: true, status: 200, json: async () => messages };
    }
    if (method === "POST" && /\/chat\/messages$/.test(url.split("?")[0] ?? "")) {
      const posted: ChatMessage = {
        messageId: 999, senderId: 1, senderGiftName: "TANGLAW", senderMemberNumber: "2024-00001",
        body: "Newly posted message", sentDateUtc: "2026-09-15T10:00:00Z",
        isDeleted: false, deletedDateUtc: null, flagCount: 0, hasFlagged: false, canSeeRemovedBody: false,
      };
      return { ok: true, status: 200, json: async () => posted };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
  }));

  return calls;
}

async function settle(ms = 60) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function renderChatRoom() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/chat"]}>
            <Routes><Route path="/chat" element={<ChatRoom chapterId={1} />} /></Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  hub.startShouldReject = false;
  hub.instances = [];
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

const SAMPLE_MESSAGE: ChatMessage = {
  messageId: 1, senderId: 2, senderGiftName: "MABALASIK", senderMemberNumber: "2024-00042",
  body: "Kumusta, mga kapatid!", sentDateUtc: "2026-09-14T09:00:00Z",
  isDeleted: false, deletedDateUtc: null, flagCount: 0, hasFlagged: false, canSeeRemovedBody: false,
};

const REMOVED_MESSAGE: ChatMessage = {
  messageId: 2, senderId: 3, senderGiftName: "BAGWIS", senderMemberNumber: "2024-00099",
  body: null, sentDateUtc: "2026-09-14T09:05:00Z",
  isDeleted: true, deletedDateUtc: "2026-09-14T10:00:00Z", flagCount: 2, hasFlagged: false, canSeeRemovedBody: false,
};

describe("loading state", () => {
  it("shows a skeleton, not a blank screen, before history resolves", async () => {
    // The default stub resolves every fetch immediately, which (unlike a real
    // network) lets React flush past "loading" before this test can ever observe
    // it — so this test holds the messages call open until it explicitly lets it go.
    let releaseMessages: (rows: ChatMessage[]) => void = () => {};
    const gate = new Promise<ChatMessage[]>(resolve => { releaseMessages = resolve; });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/api/auth/refresh")) {
        return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresAtUtc: "2099-01-01" }) };
      }
      if (url.includes("/api/auth/me")) {
        return { ok: true, status: 200, json: async () => ({ memberId: 1, chapterId: 1, chapterName: "Test", giftName: "TANGLAW", roles: ["Member"] }) };
      }
      if (url.includes("/chat/room")) {
        return { ok: true, status: 200, json: async () => ({ roomId: 1, chapterId: 1, roomName: "General", retentionMonths: 12, wasCreated: false }) };
      }
      if (url.includes("/chat/messages")) {
        const rows = await gate;
        return { ok: true, status: 200, json: async () => rows };
      }
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0, skip: 0, take: 50 }) };
    }));

    await renderChatRoom();
    // Deliberately not settled yet — the messages call is still gated open, so this
    // is what the screen looks like mid-fetch.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    releaseMessages([SAMPLE_MESSAGE]);
    await settle();
    expect(container.textContent ?? "").toContain("MABALASIK");
  });
});

describe("error state", () => {
  it("shows one plain sentence and a Retry button when history fails to load", async () => {
    stubFetch({ messagesFail: true });
    await renderChatRoom();
    await settle();

    const text = container.textContent ?? "";
    expect(text).toContain("That did not load");
    const retry = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Try again");
    expect(retry).toBeTruthy();
  });
});

describe("empty state", () => {
  it("shows warm, plain copy when there are no messages yet", async () => {
    stubFetch({ messages: [] });
    await renderChatRoom();
    await settle();

    const text = container.textContent ?? "";
    expect(text).toContain("Walang mensahe pa");
    expect(text).toContain("No messages yet");
  });
});

describe("loaded state", () => {
  it("renders each message's sender and body as plain text", async () => {
    stubFetch({ messages: [SAMPLE_MESSAGE] });
    await renderChatRoom();
    await settle();

    const text = container.textContent ?? "";
    expect(text).toContain("MABALASIK");
    expect(text).toContain("Kumusta, mga kapatid!");
  });

  it("a removed message shows a tombstone, never just vanishing", async () => {
    stubFetch({ messages: [REMOVED_MESSAGE] });
    await renderChatRoom();
    await settle();

    const text = container.textContent ?? "";
    expect(text).toContain("Message removed by an officer");
    expect(text).not.toContain("null");
  });

  it("posts a message and shows it only from the server's response, never optimistically", async () => {
    stubFetch({ messages: [] });
    await renderChatRoom();
    await settle();

    const textarea = container.querySelector("textarea[aria-label='Write a message']") as HTMLTextAreaElement;
    const form = textarea.closest("form")!;

    await act(async () => { setTextareaValue(textarea, "Hello chapter"); });
    // Immediately after typing (before submit), the text is only in the composer.
    expect(container.textContent ?? "").not.toContain("Newly posted message");

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(container.textContent ?? "").toContain("Newly posted message");
  });
});

describe("marking messages read", () => {
  it("marks the newest loaded message read once, after initial history load", async () => {
    const calls = stubFetch({ messages: [SAMPLE_MESSAGE] });
    await renderChatRoom();
    await settle();

    const readCalls = calls.filter(c => c.method === "POST" && c.url.includes("/chat/read"));
    expect(readCalls).toHaveLength(1);
    expect(JSON.parse(readCalls[0]?.body ?? "{}")).toEqual({ lastReadMessageId: SAMPLE_MESSAGE.messageId });
  });

  it("does not call read when the room has no messages yet", async () => {
    const calls = stubFetch({ messages: [] });
    await renderChatRoom();
    await settle();

    expect(calls.some(c => c.method === "POST" && c.url.includes("/chat/read"))).toBe(false);
  });

  it("marks read again when a new message arrives over SignalR, but not for the same message twice", async () => {
    const calls = stubFetch({ messages: [SAMPLE_MESSAGE] });
    await renderChatRoom();
    await settle();
    expect(calls.filter(c => c.method === "POST" && c.url.includes("/chat/read"))).toHaveLength(1);

    const instance = hub.instances.at(-1);
    const onPosted = instance?.listeners.get("MessagePosted")?.[0];
    const arrived: ChatMessage = {
      messageId: 3, senderId: 4, senderGiftName: "DIWATA", senderMemberNumber: "2024-00050",
      body: "Ingat sa uwian mamaya.", sentDateUtc: "2026-09-15T11:00:00Z",
      isDeleted: false, deletedDateUtc: null, flagCount: 0, hasFlagged: false, canSeeRemovedBody: false,
    };
    await act(async () => { onPosted?.(arrived); });
    await settle();

    const readCalls = calls.filter(c => c.method === "POST" && c.url.includes("/chat/read"));
    expect(readCalls).toHaveLength(2);
    expect(JSON.parse(readCalls[1]?.body ?? "{}")).toEqual({ lastReadMessageId: 3 });
  });
});

describe("connection banner", () => {
  it("shows a reconnecting banner and keeps the composer usable", async () => {
    stubFetch({ messages: [SAMPLE_MESSAGE] });
    await renderChatRoom();
    await settle();

    const instance = hub.instances.at(-1);
    expect(instance).toBeTruthy();
    await act(async () => { instance?.onreconnectingCb?.(); });

    expect(container.textContent ?? "").toContain("Reconnecting");
    const textarea = container.querySelector("textarea[aria-label='Write a message']") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it("disables the composer and explains why when offline", async () => {
    hub.startShouldReject = true;
    stubFetch({ messages: [SAMPLE_MESSAGE] });
    await renderChatRoom();
    await settle();

    const text = container.textContent ?? "";
    expect(text).toContain("You're offline");

    const textarea = container.querySelector("textarea[aria-label='Write a message']") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.placeholder).toContain("This message will not send");
  });
});
