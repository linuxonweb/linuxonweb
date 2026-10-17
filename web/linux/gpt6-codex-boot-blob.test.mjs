import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

let sequence = 0;

async function fixture(context, { cacheFailure = false, corrupt = false } = {}) {
  const NativeResponse = globalThis.Response;
  const NativeBlob = globalThis.Blob;
  const original = new Map(['Response', 'Blob', 'fetch', 'localStorage', 'crypto']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  context.after(() => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const bytes = new TextEncoder().encode('verified boot image');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const asset = { url: './fixture-image.bin', bytes: bytes.length, sha256: hash };
  const manifest = { schema: 1, version: 'fixture', assets: { kernel: asset, plain: asset, firefox: asset } };
  const values = new Map([['linuxonweb.system.active.v1', JSON.stringify(manifest)]]);
  const modified = 'Mon, 12 Oct 2026 10:00:00 GMT';
  const responseBodies = [], blobs = [], attempts = [], notices = [];
  let cached, downloads = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  globalThis.localStorage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) };
  globalThis.Blob = new Proxy(NativeBlob, { construct(target, args) {
    const blob = Reflect.construct(target, args);
    blobs.push(blob);
    return blob;
  } });
  globalThis.Response = new Proxy(NativeResponse, { construct(target, args) {
    responseBodies.push(args[0]);
    return Reflect.construct(target, args);
  } });
  globalThis.fetch = async (url, options = {}) => {
    assert.ok(new URL(url).pathname.endsWith('fixture-image.bin'));
    const headers = { 'Content-Length': String(bytes.length), 'Last-Modified': modified };
    if (options.method === 'HEAD') return new NativeResponse(null, { headers });
    downloads++;
    const payload = bytes.slice();
    if (corrupt) payload[0] ^= 1;
    return new NativeResponse(payload, { headers });
  };
  const api = await import(`./boot-assets.mjs?blob-regression=${++sequence}`);
  api.setImageStoreForTest({
    get: async () => cached,
    put: async record => {
      attempts.push(record);
      if (cacheFailure) throw new DOMException('disk full', 'QuotaExceededError');
      cached = record;
    },
  });
  api.onAssetNotice((message, error) => notices.push({ message, error }));
  return { api, bytes, asset, responseBodies, blobs, attempts, notices, downloads: () => downloads };
}

test('cold boot shares one immutable Blob between the cache and response', async context => {
  const probe = await fixture(context);
  const response = await probe.api.systemAsset('firefox');
  assert.equal(probe.blobs.length, 1);
  assert.equal(probe.attempts.length, 1);
  assert.equal(probe.responseBodies.length, 1);
  assert.equal(probe.responseBodies[0], probe.attempts[0].blob);
  assert.equal(probe.responseBodies[0], probe.blobs[0]);
  assert.equal(response.headers.get('X-System-SHA256'), probe.asset.sha256);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), probe.bytes);
  const warm = await probe.api.systemAsset('firefox');
  assert.equal(probe.downloads(), 1);
  assert.equal(probe.blobs.length, 1);
  assert.equal(probe.responseBodies[1], probe.blobs[0]);
  assert.deepEqual(new Uint8Array(await warm.arrayBuffer()), probe.bytes);
});

test('cache write failure still streams the same verified Blob', async context => {
  const probe = await fixture(context, { cacheFailure: true });
  const response = await probe.api.systemAsset('firefox');
  assert.equal(probe.blobs.length, 1);
  assert.equal(probe.responseBodies[0], probe.attempts[0].blob);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), probe.bytes);
  assert.equal(probe.api.assetCacheDiagnostics().writes, 0);
  assert.equal(probe.api.assetCacheDiagnostics().failures.length, 1);
  assert.ok(probe.notices.some(notice => notice.error && notice.message.includes('disk full')));
});

test('unverified bytes never reach the immutable boot Blob or cache', async context => {
  const probe = await fixture(context, { corrupt: true });
  await assert.rejects(probe.api.systemAsset('firefox'), /newer system image/);
  assert.equal(probe.blobs.length, 0);
  assert.equal(probe.responseBodies.length, 0);
  assert.equal(probe.attempts.length, 0);
});
