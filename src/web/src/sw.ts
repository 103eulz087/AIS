/// <reference lib="webworker" />
/**
 * The app's service worker source — bundled by vite-plugin-pwa's `injectManifest`
 * strategy (see vite.config.ts) into dist/sw.js. This file is NOT part of the main
 * app's TypeScript program (see tsconfig.json's own exclude) because a project can't
 * mix the DOM lib (the app) and the WebWorker lib (this file) in one compile — the
 * triple-slash reference above plus the local `declare const self` below give this
 * file its own worker-shaped globals without touching the app's tsconfig.
 *
 * Two responsibilities, both load-bearing, neither optional:
 *
 * 1. Precache + the /api/members offline-caching rule. Before this file existed,
 *    vite-plugin-pwa's generateSW strategy wrote this rule into the generated service
 *    worker automatically from vite.config.ts's own `workbox.runtimeCaching`. Moving to
 *    injectManifest (needed for #2 below) means THIS file is now the only place that
 *    rule is expressed — the member directory is what a brother reaches for to find a
 *    blood donor with no signal, so losing this silently would be a real regression,
 *    not a cosmetic one. `npm run build` + grepping the built dist/sw.js for
 *    "api\\/members" is how this is verified (see the task's own build note).
 *
 * 2. Web Push. `push` renders whatever the server's fixed-template payload contains
 *    (see PushDispatchHostedService.cs — title/body/data only, NEVER message text: a
 *    lock screen is the most exposed surface in the app). `notificationclick` deep-links
 *    based on `data.type`, set by that same backend template ("private" | "mention").
 */
export {};

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { clientsClaim } from "workbox-core";

// A newly deployed version takes over at once instead of waiting until every window of the
// app is closed (on Android an installed app can stay alive in the background for days, so
// members kept running the previous release after a deploy). main.tsx reloads the page once
// when this happens, so the new bundle is what they actually see.
self.skipWaiting();
clientsClaim();

// The standard injectManifest entry point — replaced at build time with the list of
// build assets to precache (index.html, JS/CSS bundles, the icons in public/).
precacheAndRoute(self.__WB_MANIFEST);

// Any page of the app (/digital-id, /meetings/3, /portal/…) opens from the saved app shell,
// so it still loads with no signal — not only Home. generateSW used to add this
// (navigateFallback); it was lost when this file replaced it. Never for API, live-update
// or enrolment-link server routes.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), {
  denylist: [/^\/api\//, /^\/backend\//, /^\/hubs\//, /^\/swagger/],
}));

// Your own Digital ID: NETWORK FIRST. With signal it is always fresh (a member tagged Paid
// sees it at once); only offline does it fall back to the last copy, so the ID still opens
// with no signal. (2026-10-27: under the old blanket /\/api\/members/ stale-while-revalidate
// rule the OLD copy was shown first, so a member tagged Paid kept seeing "NOT YET PAID".)
// Registered before the directory rule below: the first matching route wins.
registerRoute(
  ({ url }) => url.pathname === "/api/members/me/credential",
  new NetworkFirst({
    cacheName: "my-id",
    networkTimeoutSeconds: 6,
    plugins: [new ExpirationPlugin({ maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// The member directory (search list, photos) — what a brother reaches for to find a blood
// donor with no signal: stale-while-revalidate, one week, as before. Everything else under
// /api/members/me (profile, free-trial access, tours) is deliberately NOT cached here: it
// goes straight to the network, so it is never shown out of date — and never served to the
// next person who signs in on the same phone. Matched as "/api/members" or "/api/members/…"
// exactly: a bare prefix also caught /api/membership-applications (the sign-up approval
// queue), which officers must always see live.
registerRoute(
  ({ url }) => (url.pathname === "/api/members" || url.pathname.startsWith("/api/members/"))
    && !url.pathname.startsWith("/api/members/me"),
  new StaleWhileRevalidate({
    cacheName: "members",
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 7 })],
  }),
);

// One-off clean-up for phones that ran the old blanket rule: drop every saved copy of a
// /api/members/me response (out-of-date IDs, profiles, access states) from the old cache.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open("members");
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith("/api/members/me") || path.startsWith("/api/membership-applications")) await cache.delete(req);
      }
    } catch { /* never block activation on housekeeping */ }
  })());
});

/**
 * The shape PushSender.cs actually serializes (see PushDispatchHostedService.cs's
 * fixed templates): title/body always present, data always an object, icon/badge never
 * sent today but read here anyway per this module's own contract — a future payload
 * that does include them must not require a service-worker change to pick them up.
 */
interface PushPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  data?: unknown;
}

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    if (event.data) payload = event.data.json() as PushPayload;
  } catch {
    // A malformed or empty payload shows nothing rather than crashing the push
    // handler — a dropped notification is recoverable (the member sees the message
    // next time he opens the app); a broken service worker is not.
  }

  const title = payload.title ?? "AIS";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      icon: payload.icon ?? "/icon-192.png",
      badge: payload.badge ?? "/badge-72.png",
      data: payload.data,
    }),
  );
});

/** The two push kinds PushDispatchHostedService.cs's fixed templates can send. */
interface PushNotificationData {
  type?: "private" | "mention";
  roomId?: number;
  chapterId?: number;
}

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const data = (event.notification.data ?? {}) as PushNotificationData;
  const url = data.type === "private" && typeof data.roomId === "number"
    ? `/conversations/${data.roomId}`
    : "/chat";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        // An already-open tab is focused and navigated in place rather than opening a
        // second window — "navigate" is available on WindowClient, not the base Client
        // type matchAll's own signature returns, hence the guard.
        if ("navigate" in client && "focus" in client) {
          try {
            await client.navigate(url);
          } catch {
            // Cross-origin or otherwise un-navigable — falling through to focus() still
            // gets the member to a live window, just not necessarily on this exact URL.
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
