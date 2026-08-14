// Cross-origin isolation via service worker.
//
// The OPFS SQLite VFS needs SharedArrayBuffer, which a browser only
// grants to a cross-origin-isolated page — and that normally requires
// two response headers the server must send:
//
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp
//
// GitHub Pages serves static files with fixed headers and offers no way
// to add them. A service worker can, though: it sits in front of every
// request from this scope and re-serves the response with the headers
// attached, which is enough for the browser to isolate the page.
//
// This worker deliberately does NOT cache anything. Its only job is to
// add headers; a cache here would mean stale app code with no upgrade
// path, which is a far worse problem than the one it would solve.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // A cache-only request outside same-origin mode cannot be answered
  // here, and responding would throw. Let the browser handle it.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opaque responses have no readable headers or body to copy.
        if (response.status === 0) return response;

        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Resource-Policy", "same-origin");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      // Surface the failure rather than silently serving nothing; the
      // app renders a real error when the database cannot start.
      .catch((err) => {
        console.error("coi-serviceworker:", err);
        throw err;
      }),
  );
});
