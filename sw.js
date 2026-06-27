const CACHE_NAME = 'yoshop-v28';

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assetlinks.json',

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

const QUERYLESS_APP_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.json',
  '/assetlinks.json',
  '/app.js',
  '/style.css',
  '/offline-architecture.mjs',
  '/audit-utils.mjs',
  '/sync-utils.mjs',
  '/theme-utils.mjs',
  '/repository-service.mjs',
  '/cloud-service.mjs',
  '/permission-utils.mjs'
]);

function getCacheKey(request) {
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return request;
  }

  if (QUERYLESS_APP_PATHS.has(url.pathname)) {
    return url.pathname === '/' ? '/index.html' : url.pathname;
  }

  return request;
}

async function putInCache(request, response) {
  if (!response) return response;

  const cache = await caches.open(CACHE_NAME);
  const copy = response.clone();
  await cache.put(getCacheKey(request), copy);
  return response;
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.allSettled(
    APP_SHELL_URLS.map((url) => {
      const request = new Request(url, { cache: 'reload' });
      return fetch(request).then((response) => {
        if (!response || (!response.ok && response.type !== 'opaque')) {
          throw new Error(`Unable to cache ${url}`);
        }

        return cache.put(getCacheKey(request), response);
      });
    })
  );
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAppShell());
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

  if (
    request.url.includes('fiveserver.js') ||
    request.url.includes('livereload.js') ||
    request.url.startsWith('chrome-extension:')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => putInCache(new Request('/index.html'), response))
        .catch(async () => {
          return (
            await caches.match('/index.html') ||
            await caches.match('/') ||
            new Response('YoShop is offline. Open the app once while online to finish installing offline files.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            })
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(getCacheKey(request), { ignoreSearch: true })
      .then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (!networkResponse || (!networkResponse.ok && networkResponse.type !== 'opaque')) {
              return networkResponse;
            }

            putInCache(request, networkResponse.clone()).catch(() => { });
            return networkResponse;
          });

        if (cachedResponse) {
          networkFetch.catch(() => { });
          return cachedResponse;
        }

        return networkFetch.catch(async () => {
          if (request.destination === 'style') {
            return new Response('', {
              headers: { 'Content-Type': 'text/css' }
            });
          }

          if (request.destination === 'image') {
            return new Response('', { status: 204 });
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