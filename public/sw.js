const CACHE_NAME = 'racepulseph-shell-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];
// A service worker is useful for the deployed PWA, but it can serve stale Vite
// modules on localhost after a source edit. Clear and remove it automatically
// in local development so the operator always sees the current app.
const IS_LOCAL_DEVELOPMENT = ['localhost', '127.0.0.1'].includes(self.location.hostname);

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
  if (IS_LOCAL_DEVELOPMENT || request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Navigation is network-first so a newly deployed app is picked up quickly;
  // when race-day connectivity drops, the last cached app shell still opens.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response.ok) return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }))
  );
});
