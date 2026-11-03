import { downloadFile } from './download-progress.mjs';
import { validateFirefoxCacheLifecycle } from './firefox-cache-lifecycle.mjs';
// Immutable system images are kept in IndexedDB, one record per verified image
// keyed by its sha256, with the server's Last-Modified time. Mutable home uses
// its own storage.
const DB = 'linuxonweb.system', STORE = 'images', LEGACY_CACHE = 'linuxonweb.system.v1';
const ACTIVE = 'linuxonweb.system.active.v1';
const PREVIOUS = 'linuxonweb.system.previous.v1';
const manifestURL = new URL('./boot-manifest.json', import.meta.url);
let selected;
let cacheOnlyBoot = new Set();
let notice = () => {};
const diagnostics = { hits: 0, checks: 0, refreshes: 0, downloads: 0, writes: 0, failures: [] };
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
  if (manifest.assets.firefox.cacheLifecycle !== undefined) validateFirefoxCacheLifecycle(manifest.assets.firefox.cacheLifecycle);
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
const responseHeaders = asset => ({ 'Content-Type': asset.url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', 'Content-Length': String(asset.bytes), 'X-System-SHA256': asset.sha256 });

// --- IndexedDB image store ---
// Tests replace the browser database with an in-memory store through this hook.
let imageOverride = null;
export function setImageStoreForTest(store) { imageOverride = store; }
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
let database = null;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'sha256' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  }).catch(error => { database = null; throw error; });
  return database;
}
async function images() {
  if (imageOverride) return imageOverride;
  try {
    const db = await openDatabase();
    const store = mode => db.transaction(STORE, mode).objectStore(STORE);
    return {
      get: sha256 => request(store('readonly').get(sha256)),
      all: () => request(store('readonly').getAll()),
      keys: () => request(store('readonly').getAllKeys()),
      put: record => request(store('readwrite').put(record)),
      delete: sha256 => request(store('readwrite').delete(sha256)),
      clear: () => request(store('readwrite').clear()),
    };
  } catch { return null; }
}
// The stored copy counts only if its checksum, size and blob match the manifest.
async function localCopy(asset, store) {
  const record = await store?.get(asset.sha256).catch(() => null);
  return record && record.sha256 === asset.sha256 && record.bytes === asset.bytes && record.blob?.size === asset.bytes ? record : null;
}
const localResponse = (record, asset) => new Response(record.blob, { headers: responseHeaders(asset) });
async function deleteLegacyCache() {
  try { await caches.delete(LEGACY_CACHE); } catch { /* No CacheStorage in this browser. */ }
}
// The server's current Last-Modified time and size, from a HEAD request.
// null when the server cannot be reached, so the stored copy is kept.
async function serverCopy(url) {
  let response;
  try { response = await fetch(url, { method: 'HEAD', cache: 'no-cache' }); }
  catch { return null; }
  if (!response.ok) return null;
  return { lastModified: response.headers.get('Last-Modified'), bytes: Number(response.headers.get('Content-Length')) };
}
// Every boot: a stored image is used only while the server's modified time and
// size still match it. A changed or missing stored copy is downloaded again.
async function fetchVerified(asset, { requireCache = false, cachedOnly = false } = {}) {
  const store = await images();
  const url = new URL(asset.url, manifestURL);
  url.searchParams.set('sha256', asset.sha256);
  const local = await localCopy(asset, store);
  if (local && cachedOnly) { diagnostics.hits++; return localResponse(local, asset); }
  if (cachedOnly) throw new Error('The cached system is no longer complete. Start again and choose Update.');
  if (local) {
    diagnostics.checks++;
    const server = await serverCopy(url);
    // Server unreachable: keep the stored copy rather than fail the boot.
    if (!server) { diagnostics.hits++; return localResponse(local, asset); }
    if (server.lastModified && server.lastModified === local.lastModified && server.bytes === asset.bytes) {
      diagnostics.hits++;
      return localResponse(local, asset);
    }
    diagnostics.refreshes++;
    notice(`Updating ${asset.label || 'system image'} from the server…`);
  } else {
    notice(`Downloading ${asset.label || 'system image'}…`);
  }
  const { bytes, lastModified } = await downloadFile(url, { id: asset.sha256, label: asset.label || 'System image', total: asset.bytes, failure: 'System image download failed' });
  diagnostics.downloads++;
  if (bytes.byteLength !== asset.bytes) throw new Error('System image is incomplete or has changed on the server. Choose Update & restart to verify the current release. Your home is unchanged.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) throw new Error('The server has a newer system image. Choose Update & restart to verify it. Your home is unchanged.');
  const blob = new Blob([bytes]);
  try {
    if (!store) throw new Error('Browser image cache is unavailable');
    // The record replaces any older copy of this image and carries the modified time to compare next boot.
    await store.put({ sha256: asset.sha256, bytes: asset.bytes, lastModified, blob, savedAt: Date.now() });
    diagnostics.writes++;
  } catch (error) {
    diagnostics.failures.push(`${asset.label || asset.url}: ${error.name}: ${error.message}`);
    if (diagnostics.failures.length > 10) diagnostics.failures.shift();
    if (requireCache) throw error;
    notice(`System image is ready, but could not be cached: ${error.message}`, true);
  }
  return new Response(blob, { headers: responseHeaders(asset) });
}
export async function systemAsset(key) {
  const manifest = await activeManifest();
  return fetchVerified(manifest.assets[key], { cachedOnly: cacheOnlyBoot.has(key) });
}
const withSystemLock = operation => globalThis.navigator?.locks
  ? navigator.locks.request(LEGACY_CACHE, { mode: 'exclusive' }, operation) : operation();
// Only the small manifest and stored metadata are read before the user chooses.
// A declined update must never fall through to downloading a replaced URL.
export async function prepareSystemBoot(imageKey, choose) {
  if (!['plain', 'firefox'].includes(imageKey)) throw new Error('Invalid boot image');
  const current = await activeManifest(), store = await images();
  const keys = ['kernel', imageKey];
  async function completeCache() {
    for (const key of keys) if (!await localCopy(current.assets[key], store)) return false;
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
    await Promise.all(keys.map(key => fetchVerified(candidate.assets[key], { requireCache: true })));
    const record = { ...snapshot(candidate), previous: snapshot(current) };
    localStorage.setItem(ACTIVE, JSON.stringify(record));
    selected = Promise.resolve(record);
    cacheOnlyBoot = new Set(keys);
  });
  return true;
}
export function updateSystem(onProgress = () => {}) { return withSystemLock(async () => {
  const candidate = await latest(), current = await activeManifest(), store = await images();
  if (!store) throw new Error('Browser image cache is unavailable; system update was not activated');
  // Stage every mode before the single active-pointer write. Network, integrity,
  // quota or preference failures leave the current release and home untouched.
  // The three images download side by side; each one is verified and stored on its own.
  onProgress('Preparing system images…');
  await Promise.all(['kernel', 'plain', 'firefox'].map(key => fetchVerified(candidate.assets[key], { requireCache: true })));
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
  const store = await images();
  if (!store) throw new Error('Browser image cache is unavailable');
  await Promise.all(['kernel', 'plain', 'firefox'].map(key => fetchVerified(previous.assets[key], { requireCache: true })));
  localStorage.setItem(ACTIVE, JSON.stringify({ ...snapshot(previous), ...(current ? { previous: snapshot(current) } : {}) }));
}); }
export async function systemUsage() {
  const store = await images();
  let bytes = 0;
  if (store) for (const record of await store.all()) bytes += Number(record.bytes || 0);
  const manifest = await activeManifest().catch(() => null);
  return { bytes, version: manifest?.version || 'unavailable', previous: Boolean(previousManifest()) };
}
export async function clearSystemCache() {
  await withSystemLock(async () => {
    await (await images())?.clear();
    await deleteLegacyCache();
  });
  // Keep the pinned manifest so reload cannot silently switch versions.
}
export async function confirmSystemBoot() {
  // Only prune after the guest has actually mounted its durable home. Retain
  // the active release and one rollback release, including every stored mode.
  const booted = await activeManifest();
  await withSystemLock(async () => {
    const active = saved(ACTIVE);
    if (active?.version !== booted.version) return;
    const keep = new Set([active, previousManifest(active)].filter(Boolean).flatMap(manifest => Object.values(manifest.assets).map(asset => asset.sha256)));
    const store = await images();
    if (store) for (const sha256 of await store.keys()) {
      if (!keep.has(sha256)) await store.delete(sha256);
    }
    await deleteLegacyCache();
  });
}
