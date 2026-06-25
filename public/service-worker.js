/* Factory Ops App service worker — shell/asset cache only.
 *
 * Strategy:
 *   - Navigations: network-first, fall back to the cached app shell when offline
 *     (so the SPA boots on a phone with no signal; React then reads the outbox/cache).
 *   - Static assets (script/style/font/image): stale-while-revalidate.
 *   - DATA IS NEVER CACHED HERE. Offline data is the outbox + Dexie cache's job,
 *     not the service worker's. We deliberately skip all non-GET and API requests.
 */
/* eslint-disable no-restricted-globals */

const CACHE = 'factory-ops-v1';
const SHELL_URLS = ['/app', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isStaticAsset(request) {
  const dest = request.destination;
  return ['script', 'style', 'font', 'image'].includes(dest);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GETs. Supabase/API/data calls pass straight through.
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // App-shell navigations: network-first, fall back to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/app')))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const copy = resp.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
  // Everything else (data, XHR/fetch to APIs): default network handling.
});
