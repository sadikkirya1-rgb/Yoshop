const CACHE_NAME = 'yoshop-v27';

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',

  '/style.css',
  '/style.css?v=20260620',
  '/app.js',
  '/app.js?v=20260620',

  '/offline-architecture.mjs',
  '/audit-utils.mjs',
  '/sync-utils.mjs',
  '/theme-utils.mjs',
  '/repository-service.mjs',
  '/cloud-service.mjs',
  '/permission-utils.mjs',

  '/assets/icons/android192x192.png',
  '/assets/icons/android512x512.png',
  '/assets/icons/ios192.png',
  '/assets/icons/ios512.png',
  '/assets/icons/wind400.png',
  '/assets/icons/market.png',
  '/assets/icons/icon.png',

  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://unpkg.com/html5-qrcode',
  'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',

  'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js',
  'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js',
  'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js'
];

function sameOriginCacheKey(request) {
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return request;

  const querylessPaths = [
    '/app.js',
    '/style.css',
    '/index.html',
    '/manifest.json',
    '/offline-architecture.mjs',
    '/audit-utils.mjs',
    '/sync-utils.mjs',
    '/theme-utils.mjs',
    '/repository-service.mjs',
    '/cloud-service.mjs',
    '/permission-utils.mjs'
  ];

  return querylessPaths.includes(url.pathname) ? url.pathname : request;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(APP_SHELL_URLS.map((url) => cache.add(url)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  if (request.url.includes('fiveserver.js') || request.url.includes('livereload.js')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          return (
            await caches.match('/index.html') ||
            await caches.match('/') ||
            new Response('YoShop is offline and the app shell is not cached yet. Open the app once while online.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            })
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(sameOriginCacheKey(request), { ignoreSearch: true })
      .then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return fetch(request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200) return networkResponse;

            const url = new URL(request.url);
            const shouldRuntimeCache =
              url.origin === self.location.origin ||
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.destination === 'image' ||
              request.url.includes('firebasestorage.googleapis.com');

            if (shouldRuntimeCache) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(sameOriginCacheKey(request), copy);
              });
            }

            return networkResponse;
          })
          .catch(async () => {
            if (request.destination === 'document') {
              return await caches.match('/index.html');
            }

            return new Response('Offline: resource not available', {
              status: 408,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});