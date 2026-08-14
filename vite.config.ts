import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The "opfs" SQLite VFS bridges to a second worker through
// SharedArrayBuffer, which exists only in a cross-origin-isolated
// context. The dev and preview servers send the headers directly.
// GitHub Pages cannot, so the built app installs a service worker that
// adds them instead — see public/coi-serviceworker.js.
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Served from https://<user>.github.io/Gym-/ in production.
const REPO_BASE = "/Gym-/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? REPO_BASE : "/",
  plugins: [react()],
  server: { headers: coopCoep },
  preview: { headers: coopCoep },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
}));
