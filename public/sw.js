const CACHE_NAME = 'racepulseph-shell-v4';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/assets/racepulse-startup.webp', '/startup.js'];
const MAX_RUNTIME_CACHE_ENTRIES = 120;
const HASHED_ASSET_RE = /^\/assets\/.+-[a-zA-Z0-9_-]{6,}\.[a-z0-9]+$/i;
// A service worker is useful for the deployed PWA, but it can serve stale Vite
// modules on localhost after a source edit. Clear and remove it automatically
// in local development so the operator always sees the current app.
const IS_LOCAL_DEVELOPMENT = ['localhost', '127.0.0.1'].includes(self.location.hostname);

async function putBoundedCache(request, response) {
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  if (!response.ok || cacheControl.includes('no-store')) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME_CACHE_ENTRIES) {
    const excess = keys.length - MAX_RUNTIME_CACHE_ENTRIES;
    for (let i = 0; i < excess; i += 1) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('install', (event) => {
  if (IS_LOCAL_DEVELOPMENT) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => IS_LOCAL_DEVELOPMENT || key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => IS_LOCAL_DEVELOPMENT ? self.registration.unregister() : undefined)
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    IS_LOCAL_DEVELOPMENT ||
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/__/')
  ) return;

  // Navigation is network-first so a newly deployed app is picked up quickly;
  // when race-day connectivity drops, the last cached app shell still opens.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const contentType = response.headers.get('content-type') || '';
          if (response.ok && contentType.includes('text/html')) {
            event.waitUntil(putBoundedCache('/index.html', response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Immutable content-hashed bundles use cache-first; unhashed runtime files use network-first.
  if (HASHED_ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (!response.ok) return response;
        event.waitUntil(putBoundedCache(request, response.clone()));
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          event.waitUntil(putBoundedCache(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
