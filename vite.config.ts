import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No COOP/COEP headers here, deliberately. The database runs on the OPFS
// access-handle pool VFS, which needs neither SharedArrayBuffer nor
// cross-origin isolation. Sending the headers in dev anyway would give
// the dev server a capability production does not have, and would hide a
// regression that reintroduced the dependency until it reached the host.

// Served from https://<user>.github.io/Gym-/ in production.
const REPO_BASE = "/Gym-/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? REPO_BASE : "/",
  plugins: [react()],
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
}));
