// P2-SW-03: Include build hash in cache name for cache busting
const CACHE_NAME = "sems-pwa-v1-20250601";
const STATIC_ASSETS = [
  "/",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

// Fix #11: App shell files to cache on install
const APP_SHELL = [
  "/",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-192-maskable.png",
  "/icon-512-maskable.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

// Install event - cache static assets and app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// Fetch event - network first for API, cache first for static
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith("http")) return;

  // For API calls - always go to network
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() => {
        // Fix #11: Return JSON error for API offline fallback instead of HTML homepage
        return new Response(
          JSON.stringify({ error: "offline", code: 0 }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );
    return;
  }

  // P2-SW-02: Network-first strategy for /dashboard/* paths (always fresh data)
  if (url.pathname.startsWith("/dashboard")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, cloned);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(
            (cachedResponse) => cachedResponse || new Response("Offline", { status: 503 })
          );
        })
    );
    return;
  }

  // For static assets and pages - stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            // Cache the new response
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            return cachedResponse;
          });

        // Return cached response immediately, or wait for network
        return cachedResponse || fetchPromise;
      });
    })
  );
});
