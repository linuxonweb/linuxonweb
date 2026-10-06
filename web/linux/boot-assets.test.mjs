import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

const ACTIVE = 'linuxonweb.system.active.v1';
let sequence = 0;
async function fixture({ cached = true, parts = false } = {}) {
  const values = new Map(), entries = new Map(), payloads = new Map(), downloads = [];
  let latest, corrupt = false, offline = false;
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = {
    // CacheStorage responses have independent bodies. Response.clone() tees a
    // stream, whose cancel promise waits for both branches in Node fixtures.
    match: async key => {
      const response = entries.get(String(key));
      return response ? new Response(await response.clone().arrayBuffer(), { headers: response.headers, status: response.status }) : undefined;
    },
    put: async (key, response) => entries.set(String(key), response.clone()),
    delete: async key => entries.delete(String(key)),
  };
  globalThis.caches = { open: async () => store };
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
    const key = new URL(`./.system-cache/${asset.sha256}/fixture-${Object.keys(current.assets).find(k => current.assets[k] === asset)}.bin`, import.meta.url).href;
    const headers = { 'Content-Length': String(asset.bytes), 'X-System-SHA256': asset.sha256 };
    if (parts) {
      entries.set(key, new Response(null, { headers: { ...headers, 'Content-Length': '0', 'X-System-Parts': '1', 'X-System-Bytes': String(asset.bytes) } }));
      entries.set(key + '.part/0', new Response(payloads.get(asset.sha256), { headers: { ...headers, 'X-System-Part': '0' } }));
    } else entries.set(key, new Response(payloads.get(asset.sha256), { headers }));
  }
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('boot-manifest.json')) {
      if (offline) throw new TypeError('offline');
      return Response.json(latest);
    }
    const hash = url.searchParams.get('sha256'); downloads.push(hash);
    const data = payloads.get(hash)?.slice();
    assert.ok(data, 'only advertised assets requested');
    if (corrupt) data[0] ^= 1;
    return new Response(data);
  };
  const api = await import(`./boot-assets.mjs?update-choice-test=${++sequence}`);
  return { api, current, candidate, values, entries, downloads, store,
    setLatest: value => { latest = value; }, corrupt: () => { corrupt = true; }, offline: () => { offline = true; } };
}

test('package update choices preserve a coherent boot and never download while pending', async t => {
  await t.test('pause, then continue from complete old chunks without downloads', async () => {
    const f = await fixture({ parts: true }); let choose, offered;
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
  await t.test('missing cached assets disable Continue and cannot fetch replacement URLs', async () => {
    const f = await fixture({ cached: false });
    await assert.rejects(f.api.prepareSystemBoot('plain', details => { assert.equal(details.canContinue, false); return 'continue'; }), /not fully cached/);
    assert.deepEqual(f.downloads, []);
  });
  await t.test('cache eviction after Continue fails without any network repair', async () => {
    const f = await fixture(); await f.api.prepareSystemBoot('firefox', () => 'continue'); f.entries.clear();
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
  await t.test('offline complete cache boots without downloading', async () => {
    const f = await fixture(); f.offline();
    assert.equal(await f.api.prepareSystemBoot('plain', () => { throw Error('offline prompt'); }), true);
    assert.equal(await (await f.api.systemAsset('plain')).text(), 'old:plain'); assert.deepEqual(f.downloads, []);
  });
});
