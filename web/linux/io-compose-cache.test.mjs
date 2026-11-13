import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cpioEntry, loadDesktopInitramfs, loadDesktopExtras } from './desktop-extras.mjs';

const encoder = new TextEncoder();
const join = parts => new Uint8Array(Buffer.concat(parts));
const trailer = cpioEntry('TRAILER!!!', new Uint8Array(), 0);
const system = join([cpioEntry('large', new Uint8Array(1024 * 1024).fill(7)), cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho memo\n')), trailer]);
const extras = join([cpioEntry('extra', encoder.encode('extra bytes')), trailer]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const memoStore = () => { const map = new Map(); return { map, get: async key => map.get(key), put: async (key, value) => { map.set(key, value); } }; };
const imageResponse = bytes => new Response(bytes, { headers: { 'X-System-SHA256': sha(bytes) } });
function extrasFetch(counter) {
  return async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('desktop-extras.cpio.json')) return Response.json({ schema: 1, bytes: extras.length, sha256: sha(extras) });
    if (path.endsWith('desktop-extras.cpio')) { counter.downloads++; return new Response(extras, { headers: { 'Content-Length': String(extras.length) } }); }
    return new Response('missing', { status: 404 });
  };
}

test('memoized composition reuses the verified scan and extras and boots the same archive', async () => {
  const compressed = gzipSync(system), memo = memoStore(), counter = { downloads: 0 };
  const options = { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo };
  const sizes = [];
  const first = await loadDesktopInitramfs(imageResponse(compressed), loadDesktopExtras(extrasFetch(counter), { preserveGzip: true, composeCache: memo }), { ...options, onImage: b => sizes.push(b) });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(memo.map.has(`scan:v1:${sha(compressed)}`));
  assert.ok([...memo.map.keys()].some(key => key.startsWith('extras-gz:v1:')));
  const second = await loadDesktopInitramfs(imageResponse(compressed), loadDesktopExtras(extrasFetch(counter), { preserveGzip: true, composeCache: memo }), { ...options, onImage: b => sizes.push(b) });
  assert.equal(counter.downloads, 1, 'extras are downloaded once');
  assert.deepEqual(second, first);
  assert.deepEqual(sizes, [system.length, system.length]);
  // Layout: exact gzip image, aligned gzip extras member, aligned raw overlay.
  assert.deepEqual(second.subarray(0, compressed.length), new Uint8Array(compressed));
  const extrasAt = Math.ceil(compressed.length / 4) * 4;
  const rest = second.subarray(extrasAt);
  assert.equal(rest[0], 0x1f); assert.equal(rest[1], 0x8b);
  // The gzip member decodes to the exact verified extras; the overlay is raw cpio after it.
  const gzLength = [...memo.map.entries()].find(([key]) => key.startsWith('extras-gz:'))[1].bytes;
  assert.deepEqual(new Uint8Array(gunzipSync(rest.subarray(0, gzLength))), extras);
  const overlayAt = extrasAt + Math.ceil(gzLength / 4) * 4;
  assert.equal(new TextDecoder().decode(second.subarray(overlayAt, overlayAt + 6)), '070701');
});

test('a memo entry for a different image identity is not used', async () => {
  const memo = memoStore();
  const other = gzipSync(join([cpioEntry('init', encoder.encode('#!/bin/sh\necho other\n')), trailer]));
  memo.map.set(`scan:v1:${sha(gzipSync(system))}`, { bytes: 1, original: encoder.encode('#!/bin/sh\necho wrong\n'), packageImage: false });
  const archive = await loadDesktopInitramfs(imageResponse(other), { encoding: 'gzip', bytes: gzipSync(extras) }, { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo });
  assert.ok(new TextDecoder().decode(archive).includes('echo other'));
  assert.ok(!new TextDecoder().decode(archive).includes('echo wrong'));
});

test('raw (console) extras come from the memo after the first verified download', async () => {
  const memo = memoStore(), counter = { downloads: 0 };
  const a = await loadDesktopExtras(extrasFetch(counter), { composeCache: memo });
  await new Promise(resolve => setTimeout(resolve, 10));
  const b = await loadDesktopExtras(extrasFetch(counter), { composeCache: memo });
  assert.equal(counter.downloads, 1);
  assert.deepEqual(a, extras); assert.deepEqual(b, extras);
});
