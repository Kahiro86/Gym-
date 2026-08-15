// Serves ./dist exactly the way GitHub Pages will: plain static files
// under the repo base path, with no headers of its own.
//
// The acceptance suites run against this rather than `vite preview` for
// two reasons. It is the honest shape — a bare static host, with nothing
// a dev server might helpfully add. And `vite preview` with a base path
// served the entry module fine to curl but 404'd it to a real browser,
// which silently turned every test into a timeout.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");
const BASE = process.env.SERVE_BASE || "/Gym-/";
const PORT = Number(process.env.SERVE_PORT || 5199);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (!path.startsWith(BASE)) {
    res.writeHead(404).end("outside base path");
    return;
  }
  path = path.slice(BASE.length - 1); // keep the leading slash
  if (path.endsWith("/")) path += "index.html";

  // Contain traversal: the resolved path must stay inside dist.
  const file = resolve(join(DIST, normalize(path)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`serving dist at http://localhost:${PORT}${BASE}`));
