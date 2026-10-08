import { guestRunAgent, guestRunShell } from './test-commands.mjs';
const encoder = new TextEncoder();
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
export function desktopInitOverlay(source) {
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
    const name = decoder.decode(archive.slice(offset + 110, offset + 110 + namesize - 1)).replace(/^\.\//, '');
    if (name === 'init') original = archive.slice(dataOffset, end);
    offset = (end + 3) & ~3;
  }
  if (!original || !decoder.decode(original.subarray(0, 128)).startsWith('#!')) throw new Error('Desktop rootfs has no supported /init script.');
  const wrapper = encoder.encode('#!/bin/busybox sh\n# Host clipboard is available only through explicit browser actions.\nexport DISPLAY=:0\n/bin/clipboard-bridge &\n/bin/busybox sh /bin/linuxonweb-run-agent &\nexec /init.desktop-original "$@"\n');
  const entries = [cpioEntry('init.desktop-original', original), cpioEntry('init', wrapper),
    cpioEntry('bin/linuxonweb-run-agent', encoder.encode(guestRunAgent())), cpioEntry('bin/linuxonweb-run-shell', encoder.encode(guestRunShell())),
    // init's boot-time wget/curl self-tests compete with desktop and Firefox startup.
    cpioEntry('network-smoke-skip', new Uint8Array(), 0o100644), cpioEntry('TRAILER!!!', new Uint8Array(), 0)];
  const overlay = new Uint8Array(entries.reduce((sum, entry) => sum + entry.length, 0));
  let at = 0; for (const entry of entries) { overlay.set(entry, at); at += entry.length; }
  return overlay;
}
// Starts at boot, alongside system image decompression. The manifest is always
// fresh; the archive may come from the HTTP cache after revalidation because
// its checksum is verified against that manifest.
export async function loadDesktopExtras(fetchImpl = fetch) {
  const manifestResponse = await fetchImpl(new URL('./desktop-extras.cpio.json', import.meta.url), { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Desktop extras manifest unavailable: HTTP ${manifestResponse.status}.`);
  const manifest = await manifestResponse.json();
  if (manifest.schema !== 1 || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 64 * 1024 ** 2 || !/^[0-9a-f]{64}$/.test(manifest.sha256)) throw new Error('Invalid desktop extras manifest.');
  const response = await fetchImpl(new URL('./desktop-extras.cpio', import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Desktop extras unavailable: HTTP ${response.status}.`);
  const extras = new Uint8Array(await response.arrayBuffer());
  if (extras.length !== manifest.bytes) throw new Error('Desktop extras download is incomplete.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', extras))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('Desktop extras checksum mismatch.');
  return extras;
}
// System archive (one array or its chunks), then extras, then the init overlay,
// each starting 4-byte aligned, assembled with a single allocation.
export function desktopInitramfs(system, extras) {
  const parts = system instanceof Uint8Array ? [system] : system;
  const overlay = desktopInitOverlay(parts);
  const systemLength = parts.reduce((sum, part) => sum + part.length, 0);
  const extrasAt = Math.ceil(systemLength / 4) * 4, overlayAt = extrasAt + Math.ceil(extras.length / 4) * 4;
  const out = new Uint8Array(overlayAt + overlay.length);
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  out.set(extras, extrasAt); out.set(overlay, overlayAt);
  return out;
}
export async function appendDesktopExtras(archive, fetchImpl = fetch) {
  return desktopInitramfs(archive, await loadDesktopExtras(fetchImpl));
}
