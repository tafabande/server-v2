const CACHE_NAME = 'mediahub-v1';
const ASSETS = [
  '/',
  '/static/css/styles.css',
  '/static/css/player.css',
  '/static/js/app.js',
  '/static/js/api.js',
  '/static/js/player-manager.js',
  '/static/js/utils.js',
  '/static/js/router.js',
  '/static/js/hls.js',
  '/static/placeholder.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Bypass cache completely for all API endpoints to ensure fresh data and respect headers (e.g. NSFW toggles)
  if (url.pathname.startsWith('/api/')) {
    return; // Direct network fetch
  }

  // Handle network-first fallback strategy for /stream and /sprites JSON API endpoints
  if (
    url.pathname.includes('/api/media/') &&
    (url.pathname.endsWith('/stream') || url.pathname.endsWith('/sprites'))
  ) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, copy);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(e.request);
        })
    );
    return;
  }

  // CRITICAL: Bypass service worker cache completely for media files and previews (binary streaming data)
  if (
    url.pathname.includes('/api/media/') &&
    (url.pathname.includes('/file') || url.pathname.includes('/preview') || url.pathname.includes('/hls-secure/'))
  ) {
    return; // Let browser load it natively
  }

  // Bypass for Range requests (common in video players)
  if (e.request.headers.get('range')) {
    return; // Direct network fetch
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).catch(() => {
        // Fallback to app shell for SPA route navigations if offline
        if (e.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
