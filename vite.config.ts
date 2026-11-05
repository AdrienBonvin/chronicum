import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Shared with src/pwa.ts, which fills it ahead of time */
const MUSIC_CACHE = "music";

export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      // A new version waits for the board to be free (src/pwa.ts), never reloads mid-game
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Warhammer Clock",
        short_name: "WH Clock",
        description: "Chess clock, command points and scores for Warhammer 40,000",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#07090d",
        theme_color: "#07090d",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app and its sound effects; the music (several MB per track) is cached on its own below
        globPatterns: ["**/*.{js,css,html,svg,png}", "sounds/*.mp3"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/music/"),
            handler: "CacheFirst",
            options: {
              cacheName: MUSIC_CACHE,
              // <audio> asks for byte ranges: served from the whole file once cached
              rangeRequests: true,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
