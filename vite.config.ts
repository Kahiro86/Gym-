import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves this repo at /Gym-/, not the domain root — dev
  // stays at "/" so the existing local workflow (Playwright checks,
  // `npm run dev`) is untouched; only the production build (what the
  // deploy workflow actually ships) needs the subpath. Everything that
  // needs to know this reads it back from import.meta.env.BASE_URL
  // (main.tsx's BrowserRouter basename) rather than hardcoding it a
  // second time.
  base: mode === "production" ? "/Gym-/" : "/",
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
        // Relative, not "/" — resolves against the manifest's own URL
        // (wherever `base` ends up placing it), so this doesn't need its
        // own copy of the subpath.
        start_url: ".",
        scope: ".",
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
}));
