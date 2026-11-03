// Optional Firefox code-cache seed. Durable profile databases are never imported.
// The caller holds the ordinary home lease and has not started the guest yet.
const decoder = new TextDecoder('utf-8', { fatal: true });
const ALLOWED = Object.freeze(['startupCache.4.little', 'scriptCache.bin', 'urlCache.bin']);
const CACHE_DIRECTORY = Object.freeze(['admin', '.cache', 'mozilla', 'firefox', 'http1-profile', 'startupCache']);
const MAX_PACKED = 24 * 1024 ** 2, MAX_UNPACKED = 32 * 1024 ** 2;
const HEX = /^[0-9a-f]{64}$/;

export async function cacheSha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
async function readBounded(stream, maximum, signal) {
  const reader = stream.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error('Code-cache download exceeds its bound');
      chunks.push(value);
    }
    signal?.throwIfAborted();
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
async function download(url, maximum, fetchImpl, signal) {
  const response = await fetchImpl(url, { cache: 'no-cache', signal });
  if (!response.ok || !response.body) throw new Error(`Code-cache download failed (${response.status})`);
  const length = Number(response.headers.get('content-length'));
  if (length > maximum) throw new Error('Code-cache Content-Length exceeds its bound');
  return readBounded(response.body, maximum, signal);
}
function validateManifest(manifest, seed, archiveSha256) {
  if (![1, 2].includes(manifest?.schema) || manifest.kind !== 'linuxonweb-firefox-code-cache' ||
      manifest.source?.archiveSha256 !== archiveSha256 || seed.archiveSha256 !== archiveSha256 ||
      !HEX.test(manifest.source?.firefoxSha256 ?? '')) throw new Error('Code-cache image identity differs');
  if (manifest.schema === 2) {
    const c = manifest.compatibility, fields = c?.fields;
    const keys = ['LastVersion', 'LastOSABI', 'LastPlatformDir', 'LastAppDir'];
    if (!fields || Object.keys(fields).sort().join() !== [...keys].sort().join() ||
        !/^[A-Za-z0-9.]+_[0-9]{14}\/[0-9]{14}$/.test(fields.LastVersion) ||
        fields.LastOSABI !== 'Linux_wasm32-gcc3' || fields.LastPlatformDir !== '/opt/firefox' || fields.LastAppDir !== '/opt/firefox/browser' ||
        !Number.isSafeInteger(c.bytes) || c.bytes < 1 || c.bytes > 1024 || !HEX.test(c.sha256 ?? '') || !HEX.test(c.sourceExportSha256 ?? '')) throw new Error('Invalid generated build compatibility metadata');
  } else if (manifest.compatibility !== undefined) throw new Error('Unexpected compatibility metadata');
  const asset = manifest.asset;
  if (!asset || !HEX.test(asset.sha256 ?? '') || !Number.isSafeInteger(asset.bytes) || asset.bytes < 18 || asset.bytes > MAX_PACKED ||
      !Number.isSafeInteger(asset.unpackedBytes) || asset.unpackedBytes < 16 || asset.unpackedBytes > MAX_UNPACKED) throw new Error('Invalid code-cache asset manifest');
  if (!Array.isArray(manifest.files) || manifest.files.length !== ALLOWED.length) throw new Error('Unexpected code-cache file set');
  const seen = new Set(); let bytes = 0;
  for (const file of manifest.files) {
    if (!ALLOWED.includes(file.filename) || seen.has(file.filename) || !HEX.test(file.sha256 ?? '') ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_UNPACKED) throw new Error('Invalid code-cache file manifest');
    seen.add(file.filename); bytes += file.bytes;
  }
  if (bytes > MAX_UNPACKED) throw new Error('Code-cache files exceed their bound');
  return manifest;
}
async function unpack(bytes, manifest, signal) {
  const raw = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_UNPACKED, signal);
  if (raw.length !== manifest.asset.unpackedBytes || decoder.decode(raw.subarray(0, 8)) !== 'LOWSC01\n') throw new Error('Code-cache container size or magic differs');
  const headerLength = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(8, true);
  if (headerLength < 2 || headerLength > 16384 || headerLength + 12 > raw.length) throw new Error('Invalid code-cache header length');
  const header = JSON.parse(decoder.decode(raw.subarray(12, 12 + headerLength)));
  if (header.schema !== 1 || !Array.isArray(header.files) || header.files.length !== manifest.files.length) throw new Error('Invalid code-cache header');
  let offset = 12 + headerLength; const files = [];
  for (let i = 0; i < manifest.files.length; i++) {
    const expected = manifest.files[i], actual = header.files[i];
    if (actual.filename !== expected.filename || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || offset + actual.bytes > raw.length) throw new Error('Code-cache entry differs from manifest');
    const data = raw.subarray(offset, offset + actual.bytes); offset += actual.bytes;
    if (await cacheSha256(data) !== actual.sha256) throw new Error('Code-cache file checksum differs');
    files.push({ filename: actual.filename, data });
  }
  if (offset !== raw.length) throw new Error('Unexpected code-cache trailing bytes');
  return files;
}

/** Returns a skip reason without fetching or mutating an established home. */
export async function seedFirefoxCodeCache({ home, archiveSha256, seed, fetchImpl = fetch, signal } = {}) {
  const started = performance.now();
  const finish = result => ({ ...result, durationMs: performance.now() - started });
  if (!home || !seed || !HEX.test(seed.archiveSha256 ?? '') || !HEX.test(seed.manifestSha256 ?? '')) throw new Error('Invalid code-cache seed configuration');
  if (archiveSha256 !== seed.archiveSha256) return finish({ status: 'skipped', reason: 'image-mismatch' });
  // Any entry means this home has been used. A cleared established cache must
  // stay cleared; checking only whether the startupCache directory exists is unsafe.
  if ((await home.readdir(home.root)).length) return finish({ status: 'skipped', reason: 'established-home' });
  const controller = new AbortController(), originalSignal = signal;
  const abort = () => controller.abort(originalSignal.reason);
  if (signal?.aborted) controller.abort(signal.reason); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Code-cache import exceeded 15 seconds')), 15000);
  signal = controller.signal;
  try {
  const manifestURL = new URL(seed.manifestURL, import.meta.url);
  if (manifestURL.origin !== new URL(import.meta.url).origin) throw new Error('Code-cache manifest must be local to this application');
  const manifestBytes = await download(manifestURL, 16384, fetchImpl, signal);
  if (await cacheSha256(manifestBytes) !== seed.manifestSha256) throw new Error('Code-cache manifest checksum differs');
  const manifest = validateManifest(JSON.parse(decoder.decode(manifestBytes)), seed, archiveSha256);
  const assetURL = new URL(manifest.asset.url, manifestURL), directoryURL = new URL('.', manifestURL);
  if (assetURL.origin !== manifestURL.origin || !assetURL.pathname.startsWith(directoryURL.pathname)) throw new Error('Code-cache asset must remain in its directory');
  const packed = await download(assetURL, manifest.asset.bytes, fetchImpl, signal);
  if (packed.length !== manifest.asset.bytes || await cacheSha256(packed) !== manifest.asset.sha256) throw new Error('Code-cache asset checksum differs');
  const files = await unpack(packed, manifest, signal);
  const compatibilityBytes = manifest.schema === 2 ? new TextEncoder().encode('[Compatibility]\n' +
    ['LastVersion', 'LastOSABI', 'LastPlatformDir', 'LastAppDir'].map(key => key + '=' + manifest.compatibility.fields[key] + '\n').join('')) : null;
  if (compatibilityBytes && (compatibilityBytes.length !== manifest.compatibility.bytes || await cacheSha256(compatibilityBytes) !== manifest.compatibility.sha256)) throw new Error('Build compatibility checksum differs');
  // Validation finishes before the first mutation; recheck against an in-page
  // upload that may have happened while the download was outstanding.
  if ((await home.readdir(home.root)).length) return finish({ status: 'skipped', reason: 'home-changed-during-download' });
  signal?.throwIfAborted();
  let parent = home.root, seedAdmin;
  const context = { mode: 0o700, uid: 1000, gid: 1000 };
  for (const segment of CACHE_DIRECTORY) { parent = await home.mkdir(parent, segment, context); if (segment === 'admin') seedAdmin = parent; }
  let importedBytes = 0;
  for (const { filename, data } of files) {
    signal?.throwIfAborted();
    // create is exclusive; write resolves only after the existing strict IDB
    // transaction commits. No fsync or user-data durability rule is relaxed.
    const file = await home.create(parent, filename, 2, { ...context, mode: 0o600 });
    try {
      const written = await home.write(file.node, file.handle, 0n, data);
      if (written !== data.length) throw new Error('Short code-cache import');
      importedBytes += written;
    } finally { await home.release(file.node, file.handle); }
  }
  if (compatibilityBytes) {
    signal?.throwIfAborted();
    let profile = seedAdmin;
    // Exclusive directories: never add build metadata to a concurrently created profile.
    for (const segment of ['.mozilla', 'firefox', 'http1-profile']) profile = await home.mkdir(profile, segment, context);
    const file = await home.create(profile, 'compatibility.ini', 2, { ...context, mode: 0o600 });
    try { if (await home.write(file.node, file.handle, 0n, compatibilityBytes) !== compatibilityBytes.length) throw new Error('Short compatibility metadata write'); }
    finally { await home.release(file.node, file.handle); }
  }
  await home.settle();
  // Strict transactions finish before cancellation is reported; they are never interrupted.
  signal?.throwIfAborted();
  return finish({ status: 'seeded', compatibilityMetadata: Boolean(compatibilityBytes), files: files.length, importedBytes, downloadedBytes: packed.length + manifestBytes.length,
    archiveSha256, manifestSha256: seed.manifestSha256, source: manifest.source });
  } finally { clearTimeout(timer); originalSignal?.removeEventListener('abort', abort); }
}
