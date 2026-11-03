import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validateFirefoxCacheLifecycle, firefoxCacheProof } from './firefox-cache-lifecycle.mjs';
import { cpioEntry, desktopInitOverlay, desktopInitramfs, loadDesktopExtras, loadDesktopInitramfs } from './desktop-extras.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const bytes = value => new TextEncoder().encode(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const system = cpioEntry('init', bytes('#!/bin/busybox sh\necho original-init\n'));
function fixture(raw = cat(cpioEntry('opt/readiness-resource', bytes('resource'), 0o100644), cpioEntry('TRAILER!!!', new Uint8Array(), 0))) {
  const compressed = new Uint8Array(gzipSync(raw));
  const manifest = { schema: 1, bytes: raw.length, sha256: hash(raw), gzip: { bytes: compressed.length, sha256: hash(compressed) } };
  const policy = { schema: 1, generation: 'a'.repeat(64), desktopExtras: { bytes: raw.length, sha256: hash(raw), gzip: { ...manifest.gzip } } };
  const calls = [];
  return { raw, compressed, manifest, policy, calls, fetch: async url => { const name = new URL(url).pathname.split('/').at(-1); calls.push(name); if (name.endsWith('.json')) return Response.json(manifest); return new Response(name.endsWith('.gz') ? compressed : raw); } };
}
function proof(archive) {
  let offset = 0, result;
  while (offset < archive.length) {
    while (offset < archive.length && !archive[offset]) offset++;
    if (offset === archive.length) break;
    const header = new TextDecoder().decode(archive.subarray(offset, offset + 110));
    assert.match(header, /^07070[12]/);
    const size = parseInt(header.slice(54, 62), 16), namesize = parseInt(header.slice(94, 102), 16);
    const name = new TextDecoder().decode(archive.subarray(offset + 110, offset + 110 + namesize - 1));
    const at = (offset + 110 + namesize + 3) & ~3;
    if (name === 'etc/linuxonweb-firefox-cache-verified') result = new TextDecoder().decode(archive.subarray(at, at + size));
    offset = (at + size + 3) & ~3;
  }
  return result;
}
test('legacy and caller-decorated extras cannot activate a cache generation', () => {
  const f = fixture(); f.raw.cacheLifecycle = f.policy; f.raw.proof = firefoxCacheProof(f.policy);
  assert.equal(proof(desktopInitOverlay(system)), '');
  assert.equal(proof(desktopInitramfs(system, f.raw)), '');
});
test('exact verified raw extras authorize only the build-pinned proof line', async () => {
  const f = fixture(), extras = await loadDesktopExtras(f.fetch, { cacheLifecycle: f.policy });
  assert.equal(proof(desktopInitramfs(system, extras)), firefoxCacheProof(f.policy));
  assert.deepEqual(f.calls, ['desktop-extras.cpio.json', 'desktop-extras.cpio']);
});
test('compressed production composition propagates verified proof after image scan', async () => {
  const f = fixture(), extras = await loadDesktopExtras(f.fetch, { preserveGzip: true, cacheLifecycle: f.policy });
  const archive = await loadDesktopInitramfs(new Response(gzipSync(system)), extras, { gzip: true, preserveGzip: true, compressExtras: true });
  assert.equal(Buffer.from(archive).includes(Buffer.from(firefoxCacheProof(f.policy))), true);
  assert.deepEqual(f.calls, ['desktop-extras.cpio.json', 'desktop-extras.cpio.gz']);
});
test('changed gzip metadata cannot hide behind an unchanged raw manifest hash', async () => {
  const f = fixture(); f.manifest.gzip.sha256 = 'b'.repeat(64);
  await assert.rejects(loadDesktopExtras(f.fetch, { preserveGzip: true, cacheLifecycle: f.policy }), /exact desktop extras/);
  assert.deepEqual(f.calls, ['desktop-extras.cpio.json']);
});
test('a body changed after its manifest is rejected before proof creation', async () => {
  const f = fixture(); f.raw[120] ^= 1;
  await assert.rejects(loadDesktopExtras(f.fetch, { cacheLifecycle: f.policy }), /checksum mismatch/);
});
test('the pinned compressed and decompressed identities must describe the same data', async () => {
  const f = fixture(); f.policy.desktopExtras.sha256 = f.manifest.sha256 = 'b'.repeat(64);
  await assert.rejects(loadDesktopExtras(f.fetch, { preserveGzip: true, cacheLifecycle: f.policy }), /Decoded Firefox desktop extras identity differs/);
});
test('reserved proof entries are rejected from exact extras, including dot-prefix paths', async () => {
  for (const name of ['etc/linuxonweb-firefox-cache-verified', './etc/linuxonweb-firefox-cache-verified']) {
    const f = fixture(cpioEntry(name, bytes('forged'), 0o100644));
    await assert.rejects(loadDesktopExtras(f.fetch, { preserveGzip: true, cacheLifecycle: f.policy }), /reserved Firefox cache proof/);
  }
});
test('prebundled proof in the system image is rejected in raw and compressed paths', async () => {
  const forged = cat(system, cpioEntry('etc/linuxonweb-firefox-cache-verified', bytes('forged'), 0o100644));
  assert.throws(() => desktopInitOverlay(forged), /reserved Firefox cache proof/);
  await assert.rejects(loadDesktopInitramfs(new Response(gzipSync(forged)), fixture().raw, { gzip: true, preserveGzip: true }), /reserved Firefox cache proof/);
});
test('invalid optional metadata is rejected while absent metadata stays disabled', () => {
  assert.equal(validateFirefoxCacheLifecycle(undefined), null);
  for (const value of [null, {}, { ...fixture().policy, schema: 2 }, { ...fixture().policy, generation: 'bad' }, { ...fixture().policy, proofToken: 'forged' }]) assert.throws(() => validateFirefoxCacheLifecycle(value));
});

test('kernel-equivalent proof aliases are rejected by every composition scanner', async () => {
  for (const name of ['etc/./linuxonweb-firefox-cache-verified', 'etc//linuxonweb-firefox-cache-verified', 'etc/../etc/linuxonweb-firefox-cache-verified']) {
    const entry = cpioEntry(name, bytes('forged'), 0o100644), f = fixture(entry), image = cat(system, entry);
    await assert.rejects(loadDesktopExtras(f.fetch, { preserveGzip: true, cacheLifecycle: f.policy }), /unsafe CPIO path/);
    assert.throws(() => desktopInitOverlay(image), /unsafe CPIO path/);
    await assert.rejects(loadDesktopInitramfs(new Response(gzipSync(image)), fixture().raw, { gzip: true, preserveGzip: true }), /unsafe CPIO path/);
  }
});
