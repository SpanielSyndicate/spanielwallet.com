// Spaniel Wallet PWA — service worker.
//
// Scope: /. We cache the app shell + page bundles so the wallet
// loads instantly offline. We deliberately do NOT cache:
//
//   - any /api/* call (live data, signed quotes, etc.)
//   - the vault envelope (lives in IndexedDB, never on disk via SW)
//   - anything in /drops/cards/*.json
//
// Cache strategy:
//   - HTML pages (under /): network-first, fall back to cache
//   - Static JS/CSS: stale-while-revalidate
//   - Everything else: pass-through

const SHELL_CACHE = 'spaniel-app-shell-v1';
const STATIC_CACHE = 'spaniel-app-static-v1';

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/bootstrap.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/style.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Never cache API calls or per-card metadata JSON.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/drops/cards/')) return;
  // Vault data only lives in IndexedDB; SW never sees it.

  if (url.pathname.startsWith('/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  // Static asset bucket
  if (/\.(?:css|js|svg|png|woff2?|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone()).catch(() => null);
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    return cache.match('/');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      cache.put(request, res.clone()).catch(() => null);
      return res;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}
