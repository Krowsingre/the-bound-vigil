// The web version's offline shell. Pages are fetched fresh when there's a
// connection and served from here when there isn't; the app's own files
// (their names change with every build) are kept once fetched. Supabase is
// on another address, so books, covers and sync never pass through here.
const CACHE = "tbv-shell-v3";
// Script requests carry an Origin header and the server answers "Vary: Origin", so that is ignored.
const ANY = { ignoreVary: true };
const SCOPE = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SCOPE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page lists the files it loaded before this worker was in charge.
self.addEventListener("message", (event) => {
  const urls = (event.data && event.data.cache) || [];
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(urls.filter((u) => u.startsWith(SCOPE)).map((u) => c.match(u, ANY).then((hit) => hit || c.add(u).catch(() => undefined)))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(SCOPE)) return;
  // Home screen icons always come straight from the site, so a phone never gets a stale one.
  if (/\/bound-vigil-\d+\.png$/.test(new URL(request.url).pathname)) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((c) => c.put(SCOPE, copy));
          }
          return response;
        })
        .catch(() => caches.match(SCOPE, ANY).then((hit) => hit || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(request, ANY).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
