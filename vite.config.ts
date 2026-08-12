import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate" — a new version activating (and
      // reloading the page) without being asked would be exactly the kind
      // of surprise UI change §2's "no optimistic UI" ethos avoids
      // elsewhere in this app. PwaUpdateBanner (Layer 3) surfaces the
      // prompt through the existing toast system instead of a silent swap.
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "GymXP",
        short_name: "GymXP",
        description: "A gym tracker that turns logged sets into XP, levels, and PRs.",
        theme_color: "#1f1d1b",
        background_color: "#1f1d1b",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Fonts are self-hosted @fontsource packages bundled into the
        // build output already, so the default JS/CSS/HTML glob plus
        // fonts/images covers the whole app shell — nothing fetched at
        // runtime from a CDN needs its own runtimeCaching entry.
        globPatterns: ["**/*.{js,css,html,woff,woff2,png,svg,ico}"],
      },
    }),
  ],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
