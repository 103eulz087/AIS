import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Switched from the default generateSW strategy to injectManifest so the service
      // worker can also own push notifications (self.addEventListener("push"/
      // "notificationclick") — generateSW only ever emits its own fixed Workbox
      // boilerplate and has no hook for custom event listeners. src/sw.ts is the new
      // source; it re-expresses the /api/members offline-caching rule this app already
      // depends on (see that file's own header comment) via registerRoute, so switching
      // strategies must never be read as "the offline member directory was removed".
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: {
        name: "AKRHO Information System",
        short_name: "AIS",
        theme_color: "#171D28",
        background_color: "#EFEEEA",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    // The dev server must itself be HTTPS, not just the API: getUserMedia (QR scanning),
    // PWA install, and — since Auth slice 1 — the Secure refresh-token cookie all require
    // a secure context on THIS origin. A browser will not store a Secure cookie on a page
    // served over plain HTTP no matter what scheme the API used. See CLAUDE.md §8.2 and
    // scripts/dev-https-cert.sh, which exports the trusted ASP.NET Core dev cert here.
    https: devCertPath()
      ? { pfx: fs.readFileSync(devCertPath()!), passphrase: "devcert" }
      : undefined,
    proxy: {
      // Target the API's HTTPS port directly (not :5080) so the proxy never has to
      // relay a cross-origin 307 back to the browser — that redirect is what breaks
      // cookie storage and CORS in practice. `secure: false` accepts the same
      // self-signed dev cert on this, the proxy's own outbound connection.
      "/api": { target: "https://localhost:5443", changeOrigin: true, secure: false },
      // The chat module's SignalR hub (src/Akrho.Api/Features/Chat/ChatHub.cs) needs its
      // own entry: `ws: true` proxies the WebSocket upgrade too, which the plain-HTTP
      // "/api" entry above never needed.
      "/hubs": { target: "https://localhost:5443", changeOrigin: true, secure: false, ws: true },
    },
  },
});

function devCertPath(): string | undefined {
  const p = path.resolve(__dirname, ".certs/dev-cert.pfx");
  return fs.existsSync(p) ? p : undefined;
}
