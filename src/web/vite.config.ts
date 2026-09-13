import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
      workbox: {
        // The member directory must work with no signal — it is what a brother
        // reaches for when he needs a blood donor. Cache it deliberately.
        runtimeCaching: [{
          urlPattern: /\/api\/members/,
          handler: "StaleWhileRevalidate",
          options: { cacheName: "members", expiration: { maxAgeSeconds: 60 * 60 * 24 * 7 } },
        }],
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:5080", changeOrigin: true } },
  },
});
