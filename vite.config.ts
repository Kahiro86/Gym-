import { defineConfig } from "vite";

// COOP/COEP are required for the "opfs" SQLite VFS (it bridges to a second
// worker via SharedArrayBuffer, which only exists in a cross-origin-isolated
// context). Applied to both dev and preview so local testing matches
// whatever the eventual host must also provide — GitHub Pages cannot set
// custom response headers, so this app cannot ship there (see NOTES.md).
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers: coopCoep },
  preview: { headers: coopCoep },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
});
