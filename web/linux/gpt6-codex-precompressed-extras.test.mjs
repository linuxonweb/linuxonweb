import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpioEntry, desktopInitOverlay, loadDesktopExtras, loadDesktopInitramfs } from './desktop-extras.mjs';

globalThis.crypto ??= webcrypto;
const encoder = new TextEncoder();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const join = parts => new Uint8Array(Buffer.concat(parts));
const trailer = cpioEntry('TRAILER!!!', new Uint8Array(), 0);
const system = join([cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho preserved\n')), trailer]);
const extras = join([cpioEntry('bin/app', new Uint8Array(65536).fill(37)), trailer]);
const compressed = new Uint8Array(gzipSync(extras));
const manifest = {
  schema: 1, bytes: extras.length, sha256: digest(extras),
  gzip: { bytes: compressed.length, sha256: digest(compressed) },
};

function server(metadata = manifest, compressedBody = compressed) {
  const requests = [];
  return {
    requests,
    fetch: async (url, options) => {
      const name = new URL(url).pathname.split('/').pop();
      requests.push({ name, cache: options.cache });
      if (name === 'desktop-extras.cpio.json') return Response.json(metadata);
      if (name === 'desktop-extras.cpio.gz') return new Response(compressedBody);
      if (name === 'desktop-extras.cpio') return new Response(extras);
      throw Error('Unexpected request: ' + name);
    },
  };
}

test('opt-in fetches only the verified packaged gzip without runtime compression', async context => {
  context.mock.method(globalThis, 'CompressionStream', function () { throw Error('Unexpected runtime compression'); });
  const fixture = server();
  const actual = await loadDesktopExtras(fixture.fetch, { preserveGzip: true });
  assert.equal(actual.encoding, 'gzip');
  assert.deepEqual(actual.bytes, compressed);
  assert.deepEqual(fixture.requests.map(request => request.name), ['desktop-extras.cpio.json', 'desktop-extras.cpio.gz']);
  assert.equal(fixture.requests[0].cache, 'no-store');
});

test('ordinary callers and legacy manifests retain the raw bytes API', async () => {
  const ordinary = server();
  assert.deepEqual(await loadDesktopExtras(ordinary.fetch), extras);
  assert.equal(ordinary.requests[1].name, 'desktop-extras.cpio');
  const { gzip, ...legacy } = manifest;
  const fallback = server(legacy);
  assert.deepEqual(await loadDesktopExtras(fallback.fetch, { preserveGzip: true }), extras);
  assert.equal(fallback.requests[1].name, 'desktop-extras.cpio');
});

test('invalid gzip metadata fails before downloading any archive', async () => {
  for (const gzip of [null, {}, { bytes: 0, sha256: manifest.gzip.sha256 },
    { bytes: manifest.bytes + 65537, sha256: manifest.gzip.sha256 },
    { bytes: compressed.length, sha256: 'wrong' }]) {
    const fixture = server({ ...manifest, gzip });
    await assert.rejects(loadDesktopExtras(fixture.fetch, { preserveGzip: true }), /gzip manifest/i);
    assert.equal(fixture.requests.length, 1);
  }
});

test('truncated or substituted compressed downloads cannot become boot inputs', async () => {
  const changed = compressed.slice();
  changed[changed.length - 1] ^= 1;
  for (const body of [compressed.subarray(0, -1), changed]) {
    const fixture = server(manifest, body);
    await assert.rejects(loadDesktopExtras(fixture.fetch, { preserveGzip: true }), /incomplete|checksum/i);
    assert.equal(fixture.requests.length, 2);
  }
});

test('boot assembly preserves both gzip members exactly and appends the original init overlay', async context => {
  context.mock.method(globalThis, 'CompressionStream', function () { throw Error('Packaged extras must not be recompressed'); });
  const rootGzip = new Uint8Array(gzipSync(system));
  const fixture = server();
  const actual = await loadDesktopInitramfs(new Response(rootGzip), loadDesktopExtras(fixture.fetch, { preserveGzip: true }), {
    gzip: true, preserveGzip: true, compressExtras: true,
  });
  const extrasAt = Math.ceil(rootGzip.length / 4) * 4;
  const overlayAt = extrasAt + Math.ceil(compressed.length / 4) * 4;
  assert.deepEqual(actual.subarray(0, rootGzip.length), rootGzip);
  assert.deepEqual(actual.subarray(rootGzip.length, extrasAt), new Uint8Array(extrasAt - rootGzip.length));
  assert.deepEqual(actual.subarray(extrasAt, extrasAt + compressed.length), compressed);
  assert.deepEqual(actual.subarray(extrasAt + compressed.length, overlayAt), new Uint8Array(overlayAt - extrasAt - compressed.length));
  assert.deepEqual(actual.subarray(overlayAt), desktopInitOverlay(system));
});

test('compressed descriptors are rejected by raw boot and when malformed', async () => {
  await assert.rejects(loadDesktopInitramfs(new Response(system), { encoding: 'gzip', bytes: compressed }), /preserved gzip/i);
  for (const value of [{ encoding: 'gzip', bytes: null }, { encoding: 'gzip', bytes: extras }]) {
    await assert.rejects(loadDesktopInitramfs(new Response(gzipSync(system)), value, { gzip: true, preserveGzip: true }), /gzip extras/i);
  }
});
