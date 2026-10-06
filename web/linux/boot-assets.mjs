// Immutable system images and mutable home use separate browser stores.
const CACHE = 'linuxonweb.system.v1';
const ACTIVE = 'linuxonweb.system.active.v1';
const PREVIOUS = 'linuxonweb.system.previous.v1';
const manifestURL = new URL('./boot-manifest.json', import.meta.url);
// Bound each browser-storage transfer independently of the 88+ MiB image.
// Large Cache.put failures in QA were traced to a nearly full host /tmp,
// not a documented CacheStorage size limit; keep conservative transfer sizes.
export const SYSTEM_CHUNK_BYTES = 1024 * 1024;
let selected;
let cacheOnlyBoot = new Set();
let notice = () => {};
const diagnostics = { hits: 0, downloads: 0, writes: 0, chunkWrites: 0, failures: [] };
export function assetCacheDiagnostics() { return { ...diagnostics, failures: diagnostics.failures.slice() }; }
export function onAssetNotice(callback) { notice = callback; }
function validate(manifest) {
  if (manifest?.schema !== 1) throw new Error('Unsupported system image manifest');
  for (const key of ['kernel', 'plain', 'firefox']) {
    const asset = manifest.assets?.[key];
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw new Error(`Invalid ${key} image manifest`);
    const url = new URL(asset.url, manifestURL);
    if (url.origin !== manifestURL.origin || !url.pathname.startsWith(new URL('.', manifestURL).pathname)) throw new Error('System image must be served from this application');
  }
  return manifest;
}
function saved(key) {
  try { const value = localStorage.getItem(key); return value ? validate(JSON.parse(value)) : null; } catch { return null; }
}
function sameImages(a, b) {
  return Boolean(a && b && ['kernel', 'plain', 'firefox'].every(key =>
    a.assets[key].sha256 === b.assets[key].sha256 && a.assets[key].bytes === b.assets[key].bytes));
}
function previousManifest(current = saved(ACTIVE)) {
  try {
    const previous = current?.previous ? validate(current.previous) : saved(PREVIOUS);
    return previous && !sameImages(previous, current) ? previous : null;
  } catch { return null; }
}
const snapshot = manifest => ({ schema: manifest.schema, version: manifest.version, assets: manifest.assets });
async function latest() {
  const response = await fetch(manifestURL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`System manifest unavailable (${response.status})`);
  return validate(await response.json());
}
export async function activeManifest() {
  if (!selected) selected = (async () => {
    const current = saved(ACTIVE);
    if (current) return current;
    const manifest = await latest();
    // Failure to save a cache preference does not imply a durable home failure.
    try { localStorage.setItem(ACTIVE, JSON.stringify(manifest)); } catch { notice('System version cannot be remembered in this browser.', true); }
    return manifest;
  })().catch(error => { selected = null; throw error; });
  return selected;
}
const assetKey = asset => new URL(`./.system-cache/${asset.sha256}/${encodeURIComponent(asset.url.split('/').pop())}`, manifestURL).href;
const partKey = (key, index) => `${key}.part/${index}`;
const responseHeaders = asset => ({ 'Content-Type': asset.url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', 'Content-Length': String(asset.bytes), 'X-System-SHA256': asset.sha256 });
async function cache() { try { return await caches.open(CACHE); } catch { return null; } }
async function cachedResponse(asset, store, key) {
  const index = await store?.match(key);
  if (!index || index.headers.get('X-System-SHA256') !== asset.sha256) return null;
  const count = Number(index.headers.get('X-System-Parts') || 0);
  // Existing verified monolithic kernel/images remain readable across upgrade.
  if (!count) return Number(index.headers.get('Content-Length')) === asset.bytes ? index : null;
  if (count !== Math.ceil(asset.bytes / SYSTEM_CHUNK_BYTES) || Number(index.headers.get('X-System-Bytes')) !== asset.bytes) return null;
  const parts = [];
  for (let part = 0; part < count; part++) {
    const response = await store.match(partKey(key, part));
    const expected = Math.min(SYSTEM_CHUNK_BYTES, asset.bytes - part * SYSTEM_CHUNK_BYTES);
    if (!response || Number(response.headers.get('Content-Length')) !== expected || response.headers.get('X-System-SHA256') !== asset.sha256 || response.headers.get('X-System-Part') !== String(part)) return null;
    parts.push(response);
  }
  let position = 0, reader;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (!reader) {
            if (position === parts.length) { controller.close(); return; }
            reader = parts[position++].body.getReader();
          }
          const chunk = await reader.read();
          if (!chunk.done) { controller.enqueue(chunk.value); return; }
          reader.releaseLock(); reader = null;
        }
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
      for (; position < parts.length; position++) await parts[position].body.cancel(reason);
    },
  });
  return new Response(body, { headers: responseHeaders(asset) });
}
async function fetchVerified(asset, store, { requireCache = false, cachedOnly = false } = {}) {
  const key = assetKey(asset);
  const cached = await cachedResponse(asset, store, key);
  if (cached) { diagnostics.hits++; return cached; }
  if (cachedOnly) throw new Error('The cached system is no longer complete. Start again and choose Update.');
  // An incomplete or evicted chunk set is not a cache hit. The old index is
  // removed before repair, and a new complete index is committed last.
  await store?.delete(key);
  const url = new URL(asset.url, manifestURL);
  url.searchParams.set('sha256', asset.sha256);
  notice(`Downloading ${asset.label || 'system image'}…`);
  const response = await fetch(url, { cache: 'no-cache' });
  diagnostics.downloads++;
  if (!response.ok) throw new Error(`System image download failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) throw new Error('System image is incomplete or has changed on the server. Choose Update & restart to verify the current release. Your home is unchanged.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) throw new Error('The server has a newer system image. Choose Update & restart to verify it. Your home is unchanged.');
  try {
    if (!store) throw new Error('Browser image cache is unavailable');
    const count = Math.ceil(bytes.byteLength / SYSTEM_CHUNK_BYTES);
    for (let part = 0; part < count; part++) {
      const data = bytes.slice(part * SYSTEM_CHUNK_BYTES, Math.min(bytes.byteLength, (part + 1) * SYSTEM_CHUNK_BYTES));
      await store.put(partKey(key, part), new Response(data, { headers: {
        'Content-Length': String(data.byteLength), 'X-System-SHA256': digest, 'X-System-Part': String(part),
      } }));
      diagnostics.chunkWrites++;
    }
    await store.put(key, new Response(null, { headers: {
      ...responseHeaders(asset), 'Content-Length': '0', 'X-System-Bytes': String(bytes.byteLength), 'X-System-Parts': String(count),
    } }));
    diagnostics.writes++;
  } catch (error) {
    diagnostics.failures.push(`${asset.label || asset.url}: ${error.name}: ${error.message}`);
    if (diagnostics.failures.length > 10) diagnostics.failures.shift();
    if (requireCache) throw error;
    notice(`System image is ready, but could not be cached: ${error.message}`, true);
  }
  return new Response(bytes, { headers: responseHeaders(asset) });
}
export async function systemAsset(key) {
  const manifest = await activeManifest();
  return fetchVerified(manifest.assets[key], await cache(), { cachedOnly: cacheOnlyBoot.has(key) });
}
const withSystemLock = operation => globalThis.navigator?.locks
  ? navigator.locks.request(CACHE, { mode: 'exclusive' }, operation) : operation();
// Only the small manifest and cache metadata are read before the user chooses.
// A declined update must never fall through to downloading a replaced URL.
export async function prepareSystemBoot(imageKey, choose) {
  if (!['plain', 'firefox'].includes(imageKey)) throw new Error('Invalid boot image');
  const current = await activeManifest(), store = await cache();
  const keys = ['kernel', imageKey];
  async function completeCache() {
    for (const key of keys) {
      const response = await cachedResponse(current.assets[key], store, assetKey(current.assets[key]));
      if (!response) return false;
      await response.body?.cancel();
    }
    return true;
  }
  let candidate;
  try { candidate = await latest(); }
  catch (error) {
    if (!await completeCache()) throw error;
    cacheOnlyBoot = new Set(keys);
    notice('Update check unavailable · using the complete cached system.');
    return true;
  }
  if (sameImages(current, candidate)) { cacheOnlyBoot.clear(); return true; }
  const canContinue = await completeCache();
  const changed = ['kernel', 'plain', 'firefox'].filter(key =>
    current.assets[key].sha256 !== candidate.assets[key].sha256 || current.assets[key].bytes !== candidate.assets[key].bytes);
  const choice = await choose({ current, candidate, changed, canContinue });
  if (choice === 'continue') {
    if (!canContinue) throw new Error('The previous system is not fully cached. Choose Update to start.');
    cacheOnlyBoot = new Set(keys);
    return true;
  }
  if (choice !== 'update') return false;
  await withSystemLock(async () => {
    if (!store) throw new Error('Browser image cache is unavailable; update was not activated.');
    // Verify the selected kernel/image together before activating one pointer.
    for (const key of keys) await fetchVerified(candidate.assets[key], store, { requireCache: true });
    const record = { ...snapshot(candidate), previous: snapshot(current) };
    localStorage.setItem(ACTIVE, JSON.stringify(record));
    selected = Promise.resolve(record);
    cacheOnlyBoot = new Set(keys);
  });
  return true;
}
export function updateSystem(onProgress = () => {}) { return withSystemLock(async () => {
  const candidate = await latest(), current = await activeManifest(), store = await cache();
  if (!store) throw new Error('Browser image cache is unavailable; system update was not activated');
  // Stage every mode before the single active-pointer write. Network, integrity,
  // quota or preference failures leave the current release and home untouched.
  for (const key of ['kernel', 'plain', 'firefox']) {
    onProgress(`Preparing ${candidate.assets[key].label || key}…`);
    await fetchVerified(candidate.assets[key], store, { requireCache: true });
  }
  // Active + rollback are one atomic localStorage record. A quota failure
  // cannot replace one pointer while leaving the other partially updated.
  const changed = !sameImages(candidate, current);
  const previous = changed ? current : previousManifest();
  localStorage.setItem(ACTIVE, JSON.stringify({ ...snapshot(candidate),
    ...(previous && !sameImages(previous, candidate) ? { previous: snapshot(previous) } : {}),
  }));
  // Existing machines/loader remain pinned until the explicit page refresh.
  return { changed, version: candidate.version };
}); }
export function restorePreviousSystem() { return withSystemLock(async () => {
  const current = saved(ACTIVE), previous = previousManifest(current);
  if (!previous) throw new Error('No previous system version is available');
  const store = await cache();
  if (!store) throw new Error('Browser image cache is unavailable');
  for (const key of ['kernel', 'plain', 'firefox']) await fetchVerified(previous.assets[key], store, { requireCache: true });
  localStorage.setItem(ACTIVE, JSON.stringify({ ...snapshot(previous), ...(current ? { previous: snapshot(current) } : {}) }));
}); }
export async function systemUsage() {
  const store = await cache();
  let bytes = 0;
  if (store) for (const key of await store.keys()) bytes += Number((await store.match(key))?.headers.get('Content-Length') || 0);
  const manifest = await activeManifest().catch(() => null);
  return { bytes, version: manifest?.version || 'unavailable', previous: Boolean(previousManifest()) };
}
export async function clearSystemCache() {
  await withSystemLock(() => caches.delete(CACHE));
  // Keep the pinned manifest so reload cannot silently switch versions.
}
export async function confirmSystemBoot() {
  // Only prune after the guest has actually mounted its durable home. Retain
  // the active release and one rollback release, including every cached mode.
  const booted = await activeManifest();
  await withSystemLock(async () => {
    const active = saved(ACTIVE);
    if (active?.version !== booted.version) return;
    const keep = new Set([active, previousManifest(active)].filter(Boolean).flatMap(manifest => Object.values(manifest.assets).map(assetKey)));
    const store = await cache();
    if (store) for (const key of await store.keys()) {
      if (![...keep].some(base => key.url === base || key.url.startsWith(`${base}.part/`))) await store.delete(key);
    }
  });
}
