import { guestRunAgent, guestRunShell } from './test-commands.mjs';
import { downloadFile } from './download-progress.mjs';
import { validateFirefoxCacheLifecycle, assertFirefoxDesktopExtras, firefoxCacheProof } from './firefox-cache-lifecycle.mjs';
const CACHE_PROOF_PATH = 'etc/linuxonweb-firefox-cache-verified';
const CACHE_VERIFIED = Symbol('verified Firefox desktop composition');
// This exact protocol is emitted by overlay-persistence.py. The recovery exec
// must occur before the agent can ever open hvc0; unknown layouts fail closed.
const PACKAGE_RECOVERY_BLOCK = "\n# Signed package generations are restored before desktop processes can run.\n# Recovery is explicit; an incompatible/corrupt generation never silently falls back.\nif grep -qw 'home.persistent=1' /proc/cmdline; then\n  if grep -qw 'packages.base=1' /proc/cmdline; then\n    echo 'apk-persist: explicit base-only boot; saved generations retained' >&2\n  elif ! /usr/sbin/apk-persist restore; then\n    echo 'apk-persist: RESTORE FAILED; desktop startup stopped' >&2\n    echo 'Recovery: apk-persist disable; then Stop and Start. Saved generations are retained.' >&2\n    exec setsid cttyhack sh\n  fi\nfi\n\n";
const PACKAGE_AGENT_ANCHOR = "# Give the guest desktop account access to the devices used by TinyX/input.\n";
const RUN_AGENT = '/bin/busybox sh /bin/linuxonweb-run-agent &\n';
function packageAgentInit(original, packageImage) {
  const text = archiveNameDecoder.decode(original);
  const markers = ['apk-persist: RESTORE FAILED; desktop startup stopped', '/usr/sbin/apk-persist restore'];
  if (!packageImage && !markers.some(marker => text.includes(marker))) return { original, outerAgent: RUN_AGENT };
  const count = value => text.split(value).length - 1;
  if (markers.some(marker => count(marker) !== 1) || count(PACKAGE_AGENT_ANCHOR) !== 1 ||
      count(PACKAGE_RECOVERY_BLOCK) !== 1 || !text.includes(PACKAGE_RECOVERY_BLOCK + PACKAGE_AGENT_ANCHOR)) {
    throw new Error('Package recovery init has an unsupported or ambiguous agent activation hook.');
  }
  return { original: encoder.encode(text.replace(PACKAGE_AGENT_ANCHOR, RUN_AGENT + PACKAGE_AGENT_ANCHOR)), outerAgent: '' };
}

const encoder = new TextEncoder();
const archiveNameDecoder = new TextDecoder('utf-8', { fatal: true });
function archiveName(bytes) {
  if (!bytes.length || bytes[bytes.length - 1] !== 0 || bytes.subarray(0, -1).includes(0)) throw new Error('Desktop archive has an invalid CPIO name.');
  const name = archiveNameDecoder.decode(bytes.subarray(0, -1)).replace(/^(?:\.\/)+/, '');
  if (name !== '.' && (!name || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('Desktop archive contains an unsafe CPIO path.');
  return name;
}

export function cpioEntry(name, data, mode = 0o100755) {
  const filename = encoder.encode(name + '\0');
  const fields = [1, mode, 0, 0, 1, 0, data.length, 0, 0, 0, 0, filename.length, 0];
  const header = encoder.encode('070701' + fields.map(x => x.toString(16).padStart(8, '0')).join(''));
  const offset = (header.length + filename.length + 3) & ~3;
  const record = new Uint8Array((offset + data.length + 3) & ~3);
  record.set(header); record.set(filename, header.length); record.set(data, offset);
  return record;
}
// Byte ranges of an archive held as one array or as a list of chunks.
function archiveReader(archive) {
  const parts = archive instanceof Uint8Array ? [archive] : archive;
  const starts = []; let length = 0;
  for (const part of parts) { starts.push(length); length += part.length; }
  function slice(start, end) {
    end = Math.min(end, length);
    let lo = 0, hi = parts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= start) lo = mid; else hi = mid - 1; }
    if (start >= end) return new Uint8Array();
    if (end - starts[lo] <= parts[lo].length) return parts[lo].subarray(start - starts[lo], end - starts[lo]);
    const out = new Uint8Array(end - start);
    for (let i = lo, at = 0; at < out.length; i++) {
      const piece = parts[i].subarray(Math.max(0, start + at - starts[i]), Math.min(parts[i].length, end - starts[i]));
      out.set(piece, at); at += piece.length;
    }
    return out;
  }
  return { length, slice };
}
export function desktopInitOverlay(source) { return makeDesktopInitOverlay(source, ''); }
function makeDesktopInitOverlay(source, proof, packageImage = false) {
  const archive = archiveReader(source);
  const decoder = new TextDecoder(); let original = null, offset = 0;
  while (offset < archive.length) {
    while (offset < archive.length && archive.slice(offset, offset + 1)[0] === 0) offset++;
    if (offset === archive.length) break;
    const header = decoder.decode(archive.slice(offset, offset + 110));
    if (!/^07070[12][0-9a-fA-F]{104}$/.test(header)) throw new Error('Desktop rootfs has an invalid CPIO header.');
    const size = parseInt(header.slice(54, 62), 16), namesize = parseInt(header.slice(94, 102), 16);
    if (!namesize || namesize > 4096) throw new Error('Desktop rootfs has an invalid CPIO name.');
    const dataOffset = (offset + 110 + namesize + 3) & ~3, end = dataOffset + size;
    if (end > archive.length) throw new Error('Desktop rootfs CPIO is truncated.');
    const name = archiveName(archive.slice(offset + 110, offset + 110 + namesize));
    if (name === CACHE_PROOF_PATH) throw new Error('System image contains a reserved Firefox cache proof.');
    if (name === 'usr/sbin/apk-persist' || name.startsWith('etc/linuxonweb-packages/')) packageImage = true;
    if (name === 'init') original = archive.slice(dataOffset, end);
    offset = (end + 3) & ~3;
  }
  if (!original || !decoder.decode(original.subarray(0, 128)).startsWith('#!')) throw new Error('Desktop rootfs has no supported /init script.');
  const activation = packageAgentInit(original, packageImage); original = activation.original;
  const wrapper = encoder.encode('#!/bin/busybox sh\n# Host clipboard is available only through explicit browser actions.\nexport DISPLAY=:0\n/bin/clipboard-bridge &\n' + activation.outerAgent + 'exec /init.desktop-original "$@"\n');
  const entries = [cpioEntry('init.desktop-original', original), cpioEntry('init', wrapper),
    cpioEntry('bin/linuxonweb-run-agent', encoder.encode(guestRunAgent())), cpioEntry('bin/linuxonweb-run-shell', encoder.encode(guestRunShell())),
    // init's boot-time wget/curl self-tests compete with desktop and Firefox startup.
    cpioEntry('network-smoke-skip', new Uint8Array(), 0o100644),
    // Always overwrite earlier data: legacy/unverified compositions disable caching.
    cpioEntry(CACHE_PROOF_PATH, encoder.encode(proof), 0o100644), cpioEntry('TRAILER!!!', new Uint8Array(), 0)];
  const overlay = new Uint8Array(entries.reduce((sum, entry) => sum + entry.length, 0));
  let at = 0; for (const entry of entries) { overlay.set(entry, at); at += entry.length; }
  return overlay;
}
// This extra decoding only applies to cache-enabled images. It proves the raw
// identity as well as the compressed body and rejects a prepackaged proof file.
async function decodePinnedExtras(compressed, expectedBytes) {
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts = []; let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.length;
      if (bytes > expectedBytes) throw new Error('Decoded Firefox desktop extras exceed their pinned size.');
      parts.push(item.value);
    }
    if (bytes !== expectedBytes) throw new Error('Decoded Firefox desktop extras are incomplete.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const raw = new Uint8Array(bytes); let offset = 0;
  for (const part of parts) { raw.set(part, offset); offset += part.length; }
  return raw;
}
function assertNoReservedProof(source) {
  const archive = archiveReader(source), decoder = new TextDecoder(); let offset = 0;
  while (offset < archive.length) {
    while (offset < archive.length && archive.slice(offset, offset + 1)[0] === 0) offset++;
    if (offset === archive.length) break;
    const header = decoder.decode(archive.slice(offset, offset + 110));
    if (!/^07070[12][0-9a-fA-F]{104}$/.test(header)) throw new Error('Pinned desktop extras have an invalid CPIO header.');
    const size = parseInt(header.slice(54, 62), 16), namesize = parseInt(header.slice(94, 102), 16);
    if (!namesize || namesize > 4096) throw new Error('Pinned desktop extras have an invalid CPIO name.');
    const at = (offset + 110 + namesize + 3) & ~3, end = at + size;
    if (end > archive.length) throw new Error('Pinned desktop extras CPIO is truncated.');
    const bytes = archive.slice(offset + 110, offset + 110 + namesize);
    if (bytes[namesize - 1] !== 0 || bytes.subarray(0, -1).includes(0)) throw new Error('Pinned desktop extras have an invalid CPIO name.');
    const name = archiveName(bytes);
    if (name === CACHE_PROOF_PATH) throw new Error('Desktop extras contain a reserved Firefox cache proof.');
    offset = (end + 3) & ~3;
  }
}
// Starts at boot, alongside system image decompression. The manifest is always
// fresh; the archive may come from the HTTP cache after revalidation because
// its checksum is verified against that manifest.
export async function loadDesktopExtras(fetchImpl = fetch, { preserveGzip = false, cacheLifecycle } = {}) {
  const cachePolicy = validateFirefoxCacheLifecycle(cacheLifecycle);
  const progress = { id: 'desktop-extras', label: 'Desktop extras' };
  const manifestResponse = await fetchImpl(new URL('./desktop-extras.cpio.json', import.meta.url), { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Desktop extras manifest unavailable: HTTP ${manifestResponse.status}.`);
  const manifest = await manifestResponse.json();
  if (manifest.schema !== 1 || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 64 * 1024 ** 2 || !/^[0-9a-f]{64}$/.test(manifest.sha256)) throw new Error('Invalid desktop extras manifest.');
  if (cachePolicy) assertFirefoxDesktopExtras(cachePolicy, manifest);
  const compressed = preserveGzip && manifest.gzip !== undefined;
  const metadata = compressed ? manifest.gzip : manifest;
  if (compressed && (!metadata || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 18 || metadata.bytes > manifest.bytes + 65536 || !/^[0-9a-f]{64}$/.test(metadata.sha256))) throw new Error('Invalid desktop extras gzip manifest.');
  const asset = compressed ? './desktop-extras.cpio.gz' : './desktop-extras.cpio';
  const { bytes: extras } = await downloadFile(new URL(asset, import.meta.url), { ...progress, total: metadata.bytes, failure: 'Desktop extras unavailable', fetchImpl });
  if (extras.length !== metadata.bytes) throw new Error('Desktop extras download is incomplete.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', extras))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== metadata.sha256) throw new Error('Desktop extras checksum mismatch.');
  const result = compressed ? { encoding: 'gzip', bytes: extras } : extras;
  if (cachePolicy) {
    const raw = compressed ? await decodePinnedExtras(extras, cachePolicy.desktopExtras.bytes) : extras;
    const rawHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (raw.length !== cachePolicy.desktopExtras.bytes || rawHash !== cachePolicy.desktopExtras.sha256) throw new Error('Decoded Firefox desktop extras identity differs.');
    assertNoReservedProof(raw);
    Object.defineProperty(result, CACHE_VERIFIED, { value: firefoxCacheProof(cachePolicy) });
  }
  return result;
}
// System archive (one array or its chunks), then extras, then the init overlay,
// each starting 4-byte aligned, assembled with a single allocation.
export function desktopInitramfs(system, extras) {
  const parts = system instanceof Uint8Array ? [system] : system;
  const overlay = makeDesktopInitOverlay(parts, extras?.[CACHE_VERIFIED] ?? '');
  return assembleInitramfs(parts, extras, overlay);
}
function assembleInitramfs(parts, extras, overlay) {
  const systemLength = parts.reduce((sum, part) => sum + part.length, 0);
  const extrasAt = Math.ceil(systemLength / 4) * 4, overlayAt = extrasAt + Math.ceil(extras.length / 4) * 4;
  const out = new Uint8Array(overlayAt + overlay.length);
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  out.set(extras, extrasAt); out.set(overlay, overlayAt);
  return out;
}
async function scanInitOverlay(reader, signal) {
  let chunk = new Uint8Array(), cursor = 0, position = 0, original = null, packageImage = false;
  const decoder = new TextDecoder();
  async function take(length, collect = true, optional = false) {
    const output = collect ? new Uint8Array(length) : null;
    let copied = 0;
    while (copied < length) {
      if (cursor === chunk.length) {
        const next = await reader.read();
        signal?.throwIfAborted();
        if (next.done) {
          if (optional && copied === 0) return null;
          throw new Error('Desktop rootfs CPIO is truncated.');
        }
        chunk = next.value;
        cursor = 0;
      }
      const count = Math.min(length - copied, chunk.length - cursor);
      if (output) output.set(chunk.subarray(cursor, cursor + count), copied);
      cursor += count;
      copied += count;
      position += count;
    }
    return output;
  }
  for (;;) {
    const first = await take(1, true, true);
    if (!first) break;
    if (first[0] === 0) continue;
    const header = decoder.decode(first) + decoder.decode(await take(109));
    if (!/^07070[12][0-9a-fA-F]{104}$/.test(header)) throw new Error('Desktop rootfs has an invalid CPIO header.');
    const size = parseInt(header.slice(54, 62), 16), namesize = parseInt(header.slice(94, 102), 16);
    if (!namesize || namesize > 4096) throw new Error('Desktop rootfs has an invalid CPIO name.');
    const nameBytes = await take(namesize);
    if (nameBytes[namesize - 1] !== 0 || nameBytes.subarray(0, -1).includes(0)) throw new Error('Desktop rootfs has an invalid CPIO name.');
    const name = archiveName(nameBytes);
    await take((4 - position % 4) % 4, false);
    if (name === CACHE_PROOF_PATH) throw new Error('System image contains a reserved Firefox cache proof.');
    if (name === 'usr/sbin/apk-persist' || name.startsWith('etc/linuxonweb-packages/')) packageImage = true;
    if (name === 'init') {
      if (size > 1024 * 1024) throw new Error('Desktop rootfs init script exceeds 1 MiB.');
      original = await take(size);
    } else {
      await take(size, false);
    }
    await take((4 - position % 4) % 4, false);
  }
  if (!original) throw new Error('Desktop rootfs has no supported /init script.');
  return { bytes: position, original, packageImage };
}
export function useCompressedInitramfs(mode, search, rawRequired = false) {
  const choice = new URLSearchParams(search).get('compressed-initramfs');
  return mode === 'firefox' && !rawRequired && (choice === null || choice === '1');
}
export async function loadDesktopInitramfs(image, extras, { gzip = false, preserveGzip = false, compressExtras = false, signal, onImage = () => {}, onReady = () => {} } = {}) {
  const imageReady = Promise.resolve(image);
  const extrasReady = Promise.resolve(extras);
  imageReady.catch(() => {});
  extrasReady.catch(() => {});
  let reader, response, onAbort;
  const cancel = () => {
    if (reader) void reader.cancel(signal.reason).catch(() => {});
    else if (response?.body && !response.body.locked) void response.body.cancel(signal.reason).catch(() => {});
  };
  const interrupted = signal && new Promise((resolve, reject) => {
    onAbort = () => {
      cancel();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  interrupted?.catch(() => {});
  const wait = promise => interrupted ? Promise.race([promise, interrupted]) : promise;
  void imageReady.then(value => {
    response = value;
    if (signal?.aborted) cancel();
  }).catch(() => {});
  const parts = [];
  let bytes = 0;
  try {
    signal?.throwIfAborted();
    if (compressExtras && !(gzip && preserveGzip)) throw new Error('Tail compression requires a preserved gzip image.');
    await wait(imageReady);
    signal?.throwIfAborted();
    if (!response.body) throw new Error('System image response has no body.');
    const compressed = gzip && preserveGzip;
    const source = compressed ? response.body.pipeThrough(new TransformStream({ transform(value, controller) {
      parts.push(value);
      controller.enqueue(value);
    } })) : response.body;
    const body = gzip ? source.pipeThrough(new DecompressionStream('gzip')) : source;
    reader = body.getReader();
    if (compressed) {
      const scanned = await scanInitOverlay(reader, signal);
      onImage(scanned.bytes);
      const extraBytes = await wait(extrasReady);
      signal?.throwIfAborted();
      const overlay = makeDesktopInitOverlay(cpioEntry('init', scanned.original), extraBytes?.[CACHE_VERIFIED] ?? '', scanned.packageImage);
      let archive;
      if (extraBytes?.encoding === 'gzip') {
        const payload = extraBytes.bytes;
        if (!(payload instanceof Uint8Array) || payload.length < 18 || payload[0] !== 0x1f || payload[1] !== 0x8b || payload[2] !== 8) throw new Error('Invalid desktop gzip extras.');
        archive = assembleInitramfs(parts, payload, overlay);
      } else if (compressExtras) {
        reader.releaseLock();
        reader = null;
        const tail = new ReadableStream({ start(controller) {
          controller.enqueue(extraBytes);
          const padding = (4 - extraBytes.length % 4) % 4;
          if (padding) controller.enqueue(new Uint8Array(padding));
          controller.enqueue(overlay);
          controller.close();
        } }).pipeThrough(new CompressionStream('gzip'));
        reader = tail.getReader();
        const systemLength = parts.reduce((sum, part) => sum + part.length, 0);
        parts.push(new Uint8Array((4 - systemLength % 4) % 4));
        for (;;) {
          const { done, value } = await wait(reader.read());
          signal?.throwIfAborted();
          if (done) break;
          parts.push(value);
        }
        archive = assembleInitramfs(parts, new Uint8Array(), new Uint8Array());
      } else {
        archive = assembleInitramfs(parts, extraBytes, overlay);
      }
      onReady();
      return archive;
    }
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      parts.push(value);
      bytes += value.length;
    }
    onImage(bytes);
    const overlay = await wait(extrasReady);
    signal?.throwIfAborted();
    if (overlay?.encoding === 'gzip') throw new Error('Compressed extras require a preserved gzip image.');
    const archive = desktopInitramfs(parts, overlay);
    onReady();
    return archive;
  } catch (error) {
    if (reader) void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    reader?.releaseLock();
    parts.length = 0;
  }
}
export async function appendDesktopExtras(archive, fetchImpl = fetch) {
  return desktopInitramfs(archive, await loadDesktopExtras(fetchImpl));
}
