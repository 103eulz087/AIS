/**
 * Push-subscription lifecycle — feature detection, subscribe/unsubscribe, and the
 * platform-state classification NotificationSettings.tsx renders copy from.
 *
 * Every function here is written to NEVER throw on an unsupported platform: a cheap
 * Android phone on a bad connection, a plain iOS Safari tab, a genuinely old browser
 * are all ordinary, expected callers, not exceptional ones. Each returns a plain
 * result the caller renders — this module's half of the same honesty principle
 * DigitalId's verified-live/verified-offline/invalid QR states already apply
 * (CLAUDE.md: "never show a confident state you cannot back"). A platform that
 * cannot actually deliver push is never reported as subscribed.
 *
 * The one exception to "never throws" by design: subscribeToPush must be invoked
 * from inside a direct click handler, because iOS requires the permission prompt
 * (Notification.requestPermission) to originate from a user gesture — calling it any
 * other way is a caller bug, not a platform limitation, so this module does nothing
 * special to paper over it.
 *
 * The subscription id persisted below is NOT domain data (CLAUDE.md's "no
 * localStorage for domain data" rule targets member/chapter/financial state) — it is
 * a client-only bookkeeping pointer with no meaning outside "which row do I ask this
 * browser's own DELETE call to remove", the same category of local, non-sensitive
 * state the rule's own money/token examples are contrasted against. If this needs
 * revisiting later, IndexedDB is the natural home, per the same rule's own guidance
 * for deliberate offline/client state.
 */
import { api } from "@/shared/api";
import type { PushSubscriptionRegistered, VapidPublicKey } from "@/shared/types";

const SUBSCRIPTION_ID_KEY = "ais.push.subscriptionId";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/** iPadOS 13+ identifies as "Macintosh" in its UA string but has touch support — the standard sniff for it. */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** Best-effort major version from the UA string ("...OS 16_4..."). Null when it can't be read. Never thrown from. */
export function getIOSVersion(): number | null {
  const match = /OS (\d+)_/.exec(navigator.userAgent);
  return match ? Number(match[1]) : null;
}

export type PushPlatformState =
  /** Android / desktop Chrome, Edge, Firefox — and iOS 16.4+ installed to the Home Screen. */
  | "supported"
  /** iOS 16.4+, installed to the Home Screen — same capability as "supported", but Apple's
   *  own background-push throttling means a message can arrive noticeably late. */
  | "supported-ios"
  /** Looks like iOS, not installed to the Home Screen, push not yet available in this tab. */
  | "ios-not-installed"
  /** No PushManager, and not an iOS device that installing would fix. */
  | "unsupported";

/**
 * On iOS, `'PushManager' in window` is only ever true once a site has been installed
 * to the Home Screen — a plain Safari tab never has it, regardless of iOS version.
 * That makes PushManager's presence itself the real "is push actually usable right
 * now" signal; the iOS/UA checks below exist only to pick the RIGHT explanation when
 * it's absent (say "add to Home Screen" vs. plain "not supported").
 */
export function getPushPlatformState(): PushPlatformState {
  if (isPushSupported()) return isIOS() && isStandalone() ? "supported-ios" : "supported";

  if (isIOS()) {
    const version = getIOSVersion();
    // Push on iOS needs 16.4+ AND installation — a known-too-old iOS could add itself
    // to the Home Screen and it still wouldn't work, so it gets the same plain
    // "not supported" copy as any other old browser, never a false promise.
    if (version !== null && version < 16) return "unsupported";
    return "ios-not-installed";
  }

  return "unsupported";
}

function readSubscriptionId(): number | null {
  try {
    const raw = window.localStorage.getItem(SUBSCRIPTION_ID_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null; // Private-mode Safari, storage disabled by policy, etc. — never throws.
  }
}

function storeSubscriptionId(id: number): void {
  try {
    window.localStorage.setItem(SUBSCRIPTION_ID_KEY, String(id));
  } catch {
    // Best-effort — worst case, a later unsubscribe can't clean up server-side and
    // leaves one harmless orphaned subscription row.
  }
}

function clearSubscriptionId(): void {
  try {
    window.localStorage.removeItem(SUBSCRIPTION_ID_KEY);
  } catch {
    // Same best-effort posture as storeSubscriptionId.
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * True only if THIS browser currently holds a live PushSubscription — never inferred
 * from the stored subscriptionId alone (the browser can drop a subscription — a
 * cleared site data, a reinstalled PWA — without this app ever hearing about it).
 * Never throws; an unsupported platform or a read error both settle to false.
 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "permission-denied" | "error" };

/**
 * MUST be called from inside a direct click handler — iOS will silently refuse the
 * permission prompt otherwise. Never throws: every failure mode (unsupported
 * platform, the member declining the permission prompt, a network error registering
 * with the server) comes back as a plain, renderable result instead.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "permission-denied" };

    const registration = await navigator.serviceWorker.ready;
    const { publicKey } = await api.get<VapidPublicKey>("/api/notifications/vapid-key");
    if (!publicKey) return { ok: false, reason: "error" };

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // TS's DOM lib types PushSubscriptionOptionsInit.applicationServerKey as a
      // BufferSource whose underlying buffer must be a concrete ArrayBuffer, but
      // `new Uint8Array(n)` is typed as backed by the wider ArrayBufferLike — a real
      // Uint8Array satisfies the runtime API regardless; this cast only reconciles
      // the type, it changes no behavior.
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });

    const keys = subscription.toJSON().keys;
    const p256dh = keys?.p256dh;
    const authSecret = keys?.auth;
    if (!p256dh || !authSecret) return { ok: false, reason: "error" };

    const registered = await api.post<PushSubscriptionRegistered>("/api/notifications/subscriptions", {
      endpoint: subscription.endpoint,
      p256dh,
      authSecret,
      deviceHint: navigator.userAgent.slice(0, 200),
    });

    storeSubscriptionId(registered.subscriptionId);
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Unsubscribes the browser's own PushSubscription AND removes the server-side row.
 * Best-effort on both halves — there is no action left for the member to take on a
 * failure here, so neither half throws; the toggle simply reflects "off" afterward.
 */
export async function unsubscribeFromPush(): Promise<void> {
  try {
    if (isPushSupported()) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();
    }
  } catch {
    // Fall through to the server-side removal below regardless.
  }

  const subscriptionId = readSubscriptionId();
  if (subscriptionId !== null) {
    try {
      await api.del(`/api/notifications/subscriptions/${subscriptionId}`);
    } catch {
      // Best-effort — see this function's own header comment.
    }
    clearSubscriptionId();
  }
}
