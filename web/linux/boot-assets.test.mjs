import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

const ACTIVE = 'linuxonweb.system.active.v1';
const OLD_MODIFIED = 'Mon, 05 Oct 2026 10:00:00 GMT';
const NEW_MODIFIED = 'Tue, 06 Oct 2026 10:00:00 GMT';
let sequence = 0;
async function fixture({ cached = true } = {}) {
  const values = new Map(), records = new Map(), payloads = new Map(), downloads = [];
  let latest, corrupt = false, offline = false, serverModified = OLD_MODIFIED;
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  // Stand-in for the IndexedDB image store: one record per image, keyed by sha256.
  const store = {
    get: async sha256 => records.get(sha256),
    all: async () => [...records.values()],
    keys: async () => [...records.keys()],
    put: async record => records.set(record.sha256, record),
    delete: async sha256 => records.delete(sha256),
    clear: async () => records.clear(),
  };
  async function manifest(version) {
    const assets = {};
    for (const key of ['kernel', 'plain', 'firefox']) {
      const data = new TextEncoder().encode(`${version}:${key}`);
      const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
      payloads.set(sha256, data);
      assets[key] = { url: `./fixture-${key}.bin`, bytes: data.length, sha256, label: key };
    }
    return { schema: 1, version, assets };
  }
  const current = await manifest('old'), candidate = await manifest('new');
  values.set(ACTIVE, JSON.stringify(current)); latest = candidate;
  if (cached) for (const asset of Object.values(current.assets)) {
    records.set(asset.sha256, { sha256: asset.sha256, bytes: asset.bytes, lastModified: OLD_MODIFIED, blob: new Blob([payloads.get(asset.sha256)]), savedAt: 0 });
  }
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('boot-manifest.json')) {
      if (offline) throw new TypeError('offline');
      return Response.json(latest);
    }
    const hash = url.searchParams.get('sha256');
    const data = payloads.get(hash);
    assert.ok(data, 'only advertised assets requested');
    if (options.method === 'HEAD') {
      if (offline) throw new TypeError('offline');
      return new Response(null, { headers: { 'Content-Length': String(data.length), 'Last-Modified': serverModified } });
    }
    downloads.push(hash);
    const body = data.slice();
    if (corrupt) body[0] ^= 1;
    return new Response(body, { headers: { 'Last-Modified': serverModified } });
  };
  const api = await import(`./boot-assets.mjs?update-choice-test=${++sequence}`);
  api.setImageStoreForTest(store);
  return { api, current, candidate, values, records, downloads, store,
    setLatest: value => { latest = value; }, corrupt: () => { corrupt = true; }, offline: () => { offline = true; },
    setServerModified: value => { serverModified = value; } };
}

test('package update choices preserve a coherent boot and never download while pending', async t => {
  await t.test('pause, then continue from complete stored images without downloads', async () => {
    const f = await fixture(); let choose, offered;
    const pending = f.api.prepareSystemBoot('firefox', details => { offered = details; return new Promise(resolve => { choose = resolve; }); });
    while (!choose) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(offered.canContinue, true); assert.deepEqual(f.downloads, []);
    assert.equal(JSON.parse(f.values.get(ACTIVE)).version, 'old');
    choose('continue'); assert.equal(await pending, true);
    for (const key of ['kernel', 'firefox']) assert.equal(await (await f.api.systemAsset(key)).text(), `old:${key}`);
    assert.deepEqual(f.downloads, []);
  });
  await t.test('cancel leaves the previous pointer and downloads unchanged', async () => {
    const f = await fixture(); assert.equal(await f.api.prepareSystemBoot('plain', () => 'cancel'), false);
    assert.equal(JSON.parse(f.values.get(ACTIVE)).version, 'old'); assert.deepEqual(f.downloads, []);
  });
  await t.test('Update stages only the chosen kernel/image and switches them together', async () => {
    const f = await fixture(); assert.equal(await f.api.prepareSystemBoot('firefox', () => 'update'), true);
    assert.deepEqual(f.downloads, [f.candidate.assets.kernel.sha256, f.candidate.assets.firefox.sha256]);
    assert.equal((await f.api.activeManifest()).version, 'new');
    assert.equal(JSON.parse(f.values.get(ACTIVE)).previous.version, 'old');
    for (const key of ['kernel', 'firefox']) assert.equal(await (await f.api.systemAsset(key)).text(), `new:${key}`);
  });
  await t.test('missing stored assets disable Continue and cannot fetch replacement URLs', async () => {
    const f = await fixture({ cached: false });
    await assert.rejects(f.api.prepareSystemBoot('plain', details => { assert.equal(details.canContinue, false); return 'continue'; }), /not fully cached/);
    assert.deepEqual(f.downloads, []);
  });
  await t.test('store eviction after Continue fails without any network repair', async () => {
    const f = await fixture(); await f.api.prepareSystemBoot('firefox', () => 'continue'); f.records.clear();
    await assert.rejects(f.api.systemAsset('kernel'), /cached system is no longer complete/); assert.deepEqual(f.downloads, []);
  });
  await t.test('corrupt update leaves active release untouched', async () => {
    const f = await fixture(); f.corrupt();
    await assert.rejects(f.api.prepareSystemBoot('plain', () => 'update'), /verify/);
    assert.equal((await f.api.activeManifest()).version, 'old'); assert.equal(JSON.parse(f.values.get(ACTIVE)).version, 'old');
  });
  await t.test('unchanged manifest needs no choice', async () => {
    const f = await fixture(); f.setLatest(f.current);
    assert.equal(await f.api.prepareSystemBoot('plain', () => { throw Error('unnecessary choice'); }), true);
    assert.deepEqual(f.downloads, []);
  });
  await t.test('offline complete store boots without downloading', async () => {
    const f = await fixture(); f.offline();
    assert.equal(await f.api.prepareSystemBoot('plain', () => { throw Error('offline prompt'); }), true);
    assert.equal(await (await f.api.systemAsset('plain')).text(), 'old:plain'); assert.deepEqual(f.downloads, []);
  });
});

test('every boot checks the stored file against the server modified time', async t => {
  await t.test('same modified time uses the stored copy without downloading', async () => {
    const f = await fixture();
    assert.equal(await (await f.api.systemAsset('plain')).text(), 'old:plain');
    assert.deepEqual(f.downloads, []);
    assert.equal(f.api.assetCacheDiagnostics().checks, 1);
  });
  await t.test('a newer server modified time downloads the image and stores the new time', async () => {
    const f = await fixture();
    f.setServerModified(NEW_MODIFIED);
    assert.equal(await (await f.api.systemAsset('plain')).text(), 'old:plain');
    assert.deepEqual(f.downloads, [f.current.assets.plain.sha256]);
    assert.equal(f.records.get(f.current.assets.plain.sha256).lastModified, NEW_MODIFIED);
    // The next boot now matches the server and downloads nothing.
    await f.api.systemAsset('plain');
    assert.deepEqual(f.downloads, [f.current.assets.plain.sha256]);
  });
  await t.test('a missing stored copy is downloaded on boot', async () => {
    const f = await fixture({ cached: false });
    assert.equal(await (await f.api.systemAsset('plain')).text(), 'old:plain');
    assert.deepEqual(f.downloads, [f.current.assets.plain.sha256]);
  });
});
