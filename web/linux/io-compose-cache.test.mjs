import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cpioEntry, loadDesktopInitramfs, loadDesktopExtras, localHostnameRequested, desktopInitOverlay } from './desktop-extras.mjs';

const encoder = new TextEncoder();
const join = parts => new Uint8Array(Buffer.concat(parts));
const trailer = cpioEntry('TRAILER!!!', new Uint8Array(), 0);
const system = join([cpioEntry('large', new Uint8Array(1024 * 1024).fill(7)), cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho memo\n')), trailer]);
const extras = join([cpioEntry('extra', encoder.encode('extra bytes')), trailer]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const memoStore = () => { const map = new Map(); return { map, get: async key => map.get(key), put: async (key, value) => { map.set(key, value); },
  retain: async keep => { for (const key of [...map.keys()]) if (!keep.has(key)) map.delete(key); } }; };
const imageResponse = bytes => new Response(bytes, { headers: { 'X-System-SHA256': sha(bytes) } });
function extrasFetch(counter, bytes = extras) {
  return async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('desktop-extras.cpio.json')) return Response.json({ schema: 1, bytes: bytes.length, sha256: sha(bytes) });
    if (path.endsWith('desktop-extras.cpio')) { counter.downloads++; return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } }); }
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

test('composition prunes memo entries of old image and extras identities and keeps current ones', async () => {
  const memo = memoStore(), counter = { downloads: 0 };
  const options = { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo };
  const oldImage = gzipSync(system);
  await loadDesktopInitramfs(imageResponse(oldImage), loadDesktopExtras(extrasFetch(counter), { preserveGzip: true, composeCache: memo }), options);
  await loadDesktopExtras(extrasFetch(counter), { composeCache: memo }); // console boot stores the raw entry too
  await new Promise(resolve => setTimeout(resolve, 20));
  const oldKeys = [`scan:v1:${sha(oldImage)}`, `extras-raw:v1:${sha(extras)}:${extras.length}`, `extras-gz:v1:${sha(extras)}:${extras.length}`];
  for (const key of oldKeys) assert.ok(memo.map.has(key), key);
  memo.map.set('unrelated:v9:x', 1);
  // A console boot (no scan identity) must not drop the Firefox scan entry.
  await loadDesktopInitramfs(new Response(system), loadDesktopExtras(extrasFetch(counter), { composeCache: memo }), { composeCache: memo });
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const key of oldKeys) assert.ok(memo.map.has(key), `console boot kept ${key}`);
  // New image and new extras manifest.
  const newSystem = join([cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho new\n')), trailer]);
  const newExtras = join([cpioEntry('extra', encoder.encode('new extra bytes')), trailer]);
  const newImage = gzipSync(newSystem);
  const archive = await loadDesktopInitramfs(imageResponse(newImage), loadDesktopExtras(extrasFetch(counter, newExtras), { preserveGzip: true, composeCache: memo }), options);
  assert.ok(new TextDecoder().decode(gunzipSync(archive.subarray(0, newImage.length))).includes('echo new'));
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const key of oldKeys) assert.ok(!memo.map.has(key), `pruned ${key}`);
  assert.ok(memo.map.has(`scan:v1:${sha(newImage)}`));
  assert.ok(memo.map.has(`extras-raw:v1:${sha(newExtras)}:${newExtras.length}`));
  assert.ok(memo.map.has(`extras-gz:v1:${sha(newExtras)}:${newExtras.length}`));
  assert.ok(memo.map.has('unrelated:v9:x'), 'unknown kinds are left alone');
  // A memo hit of the new identities keeps them.
  await loadDesktopInitramfs(imageResponse(newImage), loadDesktopExtras(extrasFetch(counter, newExtras), { preserveGzip: true, composeCache: memo }), options);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(memo.map.size, 4);
});

test('a failing or throwing retain never breaks composition', async () => {
  const memo = memoStore();
  memo.retain = () => { throw new Error('boom'); };
  const compressed = gzipSync(system);
  const archive = await loadDesktopInitramfs(imageResponse(compressed), loadDesktopExtras(extrasFetch({ downloads: 0 }), { preserveGzip: true, composeCache: memo }), { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo });
  assert.ok(archive.length > compressed.length);
  memo.retain = async () => { throw new Error('async boom'); };
  await loadDesktopInitramfs(imageResponse(compressed), loadDesktopExtras(extrasFetch({ downloads: 0 }), { preserveGzip: true, composeCache: memo }), { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo });
});

function pgzFetch(counter, bytes = extras, gz = gzipSync(bytes)) {
  return async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('desktop-extras.cpio.json')) return Response.json({ schema: 1, bytes: bytes.length, sha256: sha(bytes), gzip: { bytes: gz.length, sha256: sha(gz) } });
    if (path.endsWith('desktop-extras.cpio.gz')) { counter.gz++; return new Response(gz, { headers: { 'Content-Length': String(gz.length) } }); }
    if (path.endsWith('desktop-extras.cpio')) { counter.raw++; return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } }); }
    return new Response('missing', { status: 404 });
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('precompressed extras are memoized after one verified download and compose identically', async () => {
  const compressed = gzipSync(system), memo = memoStore(), counter = { gz: 0, raw: 0 }, gz = gzipSync(extras);
  const options = { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo };
  const first = await loadDesktopInitramfs(imageResponse(compressed), loadDesktopExtras(pgzFetch(counter, extras, gz), { preserveGzip: true, composeCache: memo }), options);
  await pause(10);
  const key = `extras-pgz:v1:${sha(extras)}:${extras.length}`;
  const stored = memo.map.get(key);
  assert.ok(stored, 'precompressed entry stored');
  assert.equal(stored.bytes, gz.length); assert.equal(stored.sha256, sha(gz));
  assert.deepEqual(counter, { gz: 1, raw: 0 });
  const second = await loadDesktopInitramfs(imageResponse(compressed), loadDesktopExtras(pgzFetch(counter, extras, gz), { preserveGzip: true, composeCache: memo }), options);
  assert.deepEqual(counter, { gz: 1, raw: 0 }, 'no .gz or .cpio download on the memoized boot');
  assert.deepEqual(second, first);
  const direct = await loadDesktopExtras(pgzFetch(counter, extras, gz), { preserveGzip: true, composeCache: memo });
  assert.equal(direct.encoding, 'gzip'); assert.deepEqual(direct.bytes, new Uint8Array(gz));
});

test('a precompressed memo entry that does not match the manifest gzip identity is re-downloaded', async () => {
  const counter = { gz: 0, raw: 0 }, gz = gzipSync(extras), key = `extras-pgz:v1:${sha(extras)}:${extras.length}`;
  const wrong = gzipSync(join([cpioEntry('extra', encoder.encode('WRONG bytes')), trailer]));
  for (const value of [
    { blob: new Blob([wrong]), bytes: wrong.length, sha256: sha(wrong) },
    { blob: new Blob([wrong]), bytes: gz.length, sha256: sha(wrong) },
    { blob: new Blob([wrong]), bytes: wrong.length, sha256: sha(gz) },
  ]) {
    const memo = memoStore(); memo.map.set(key, value);
    const before = counter.gz;
    const result = await loadDesktopExtras(pgzFetch(counter, extras, gz), { preserveGzip: true, composeCache: memo });
    assert.equal(counter.gz, before + 1, 'mismatching entry ignored');
    assert.deepEqual(result.bytes, new Uint8Array(gz));
    await pause(10);
    assert.equal(memo.map.get(key).sha256, sha(gz), 'entry replaced by the verified download');
  }
});

test('without a memo the precompressed archive is downloaded every time', async () => {
  const counter = { gz: 0, raw: 0 };
  await loadDesktopExtras(pgzFetch(counter), { preserveGzip: true });
  await loadDesktopExtras(pgzFetch(counter), { preserveGzip: true });
  assert.deepEqual(counter, { gz: 2, raw: 0 });
});

test('composition prunes precompressed entries of old extras identities and keeps the current one', async () => {
  const memo = memoStore(), counter = { gz: 0, raw: 0 };
  const options = { gzip: true, preserveGzip: true, compressExtras: true, composeCache: memo };
  const image = gzipSync(system);
  await loadDesktopInitramfs(imageResponse(image), loadDesktopExtras(pgzFetch(counter), { preserveGzip: true, composeCache: memo }), options);
  await pause(20);
  const oldKey = `extras-pgz:v1:${sha(extras)}:${extras.length}`;
  assert.ok(memo.map.has(oldKey));
  // A console (raw) boot of the same extras identity keeps the Firefox entry.
  await loadDesktopInitramfs(new Response(system), loadDesktopExtras(pgzFetch(counter), { composeCache: memo }), { composeCache: memo });
  await pause(20);
  assert.ok(memo.map.has(oldKey), 'console boot kept the precompressed entry');
  const newExtras = join([cpioEntry('extra', encoder.encode('newer extra bytes')), trailer]);
  await loadDesktopInitramfs(imageResponse(image), loadDesktopExtras(pgzFetch(counter, newExtras), { preserveGzip: true, composeCache: memo }), options);
  await pause(20);
  assert.ok(!memo.map.has(oldKey), 'old precompressed identity pruned');
  assert.ok(memo.map.has(`extras-pgz:v1:${sha(newExtras)}:${newExtras.length}`), 'current precompressed identity kept');
  // A memo hit of the current identity keeps it too.
  await loadDesktopInitramfs(imageResponse(image), loadDesktopExtras(pgzFetch(counter, newExtras), { preserveGzip: true, composeCache: memo }), options);
  await pause(20);
  assert.ok(memo.map.has(`extras-pgz:v1:${sha(newExtras)}:${newExtras.length}`));
});

test('local hostname resolution is on by default and local-hostname=0 opts out', () => {
  assert.equal(localHostnameRequested(''), true);
  assert.equal(localHostnameRequested('?local-hostname=1'), true);
  assert.equal(localHostnameRequested('?local-hostname=0'), false);
  const overlay = new TextDecoder().decode(desktopInitOverlay(join([cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho init\n')), trailer])));
  assert.ok(overlay.includes('> /etc/hosts'), 'wrapper writes /etc/hosts by default');
  assert.ok(overlay.includes('/bin/busybox hostname'));
});
