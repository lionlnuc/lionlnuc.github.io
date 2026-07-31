const CACHE_VERSION = 'v3';
const SHELL_CACHE = `museboard-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `museboard-runtime-${CACHE_VERSION}`;
const APP_ROOT = new URL('./', self.registration.scope).href;
const CORE_ASSETS = [
  APP_ROOT,
  new URL('manifest.webmanifest', self.registration.scope).href,
  new URL('icons/museboard.svg', self.registration.scope).href,
  new URL('icons/museboard-192.png', self.registration.scope).href,
  new URL('icons/museboard-512.png', self.registration.scope).href,
];

async function cacheResponse(cache, request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return undefined;
  }
}

async function precacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  const rootResponse = await cacheResponse(cache, APP_ROOT);
  const urls = new Set(CORE_ASSETS);

  if (rootResponse?.ok) {
    const html = await rootResponse.text();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = new URL(match[1], APP_ROOT);
      if (url.origin === self.location.origin) urls.add(url.href);
    }
  }

  await Promise.all([...urls].map((url) => cacheResponse(cache, url)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('museboard-') && !keep.has(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreVary: true })) || (await caches.match(APP_ROOT, { ignoreVary: true })) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
