// Opt-in service worker for ?wasm-precompile=<url>&wasm-precompile-sw=1
// (registered only by wasm-precompile.mjs). It answers GET requests for the
// one content-hash wasm URL under /linux/precompile/ from a single named
// Cache Storage entry so Chromium can keep compiled code as side data on that
// entry. Every other request gets no respondWith and goes to the network.
const PREFIX = '/linux/precompile/';
const CACHE = 'linuxonweb-wasm-precompile-v1';

self.addEventListener('install', () => { self.skipWaiting(); });
// Claim so the first parameterized load is served through the cache too.
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

async function cachedWasm(request, url) {
  const cache = await caches.open(CACHE);
  // A new image means a new content-hash URL: drop every other entry.
  for (const old of await cache.keys()) {
    if (new URL(old.url).pathname !== url.pathname) await cache.delete(old);
  }
  const hit = await cache.match(url.pathname);
  if (hit) return hit;
  const network = await fetch(request.url, { cache: 'no-store', credentials: 'same-origin' });
  if (!network.ok) return network;
  // Normalize headers: wasm MIME for compileStreaming, CORP for COEP
  // require-corp, and no "no-store" on the stored copy.
  const headers = new Headers({
    'Content-Type': 'application/wasm',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  const length = network.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  await cache.put(url.pathname, new Response(network.body, { status: 200, headers }));
  // Return the Cache Storage copy so the first compile is already cache-backed.
  return (await cache.match(url.pathname)) || fetch(request.url, { cache: 'no-store' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX) || !url.pathname.endsWith('.wasm')) return;
  if (request.headers.has('range')) return;
  event.respondWith(cachedWasm(request, url));
});
