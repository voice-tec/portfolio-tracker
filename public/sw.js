// Trackfolio Service Worker
const CACHE_NAME = "trackfolio-v1";

// File da cachare per uso offline
const STATIC_ASSETS = [
  "/",
  "/index.html",
];

// Install — precache assets statici
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — pulisci cache vecchie
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — strategia: Network first, fallback cache
// Le API non vengono mai cachate (dati real-time)
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Non cachare API calls
  if (url.pathname.startsWith("/api/")) return;

  // Network first per tutto il resto
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Aggiorna cache con versione fresca
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — serve dalla cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback a index.html per SPA routing
          if (event.request.destination === "document") {
            return caches.match("/index.html");
          }
        });
      })
  );
});

// Notifica update disponibile ai client
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
