import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

// "virtual:pwa-register/react" is normally supplied by the VitePWA plugin
// (vite.config.ts, the real app build) — vitest doesn't load that plugin,
// so without this, Vite's own import-analysis would fail to resolve the
// specifier before tests/setup.ts's vi.mock() ever gets a chance to
// substitute its content. This only needs to make the id resolvable; the
// actual stub implementation lives in the vi.mock() call.
const stubPwaRegisterVirtualModule: Plugin = {
  name: "stub-pwa-register-virtual-module",
  resolveId(id) {
    if (id === "virtual:pwa-register/react") return id;
  },
  load(id) {
    if (id === "virtual:pwa-register/react") return "export function useRegisterSW() { return {}; }";
  },
};

export default defineConfig({
  plugins: [stubPwaRegisterVirtualModule],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
  },
});
