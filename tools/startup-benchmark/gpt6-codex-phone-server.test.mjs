import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { serveFrozenRoutes } from './gpt6-codex-phone-server.mjs';

async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phone-routes-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.alloc(131072, 71);
  const snapshot = path.join(directory, 'archive');
  await fs.writeFile(snapshot, bytes);
  const entry = { snapshot, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  return { bytes, entry, routes: { '/linux/initramfs-firefox.cpio.gz': entry } };
}

test('serves exact pinned bytes with isolation and no caching', async context => {
  const { bytes, routes } = await fixture(context);
  const server = await serveFrozenRoutes(routes);
  context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  assert.equal(server.address().address, '127.0.0.1');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/linux/initramfs-firefox.cpio.gz?test=1`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const head = await fetch(`${origin}/linux/initramfs-firefox.cpio.gz`, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/linux/initramfs-firefox.cpio.gz`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/owner-setup`)).status, 200);
});

test('rejects corrupted hashes and lengths before opening a listener', async context => {
  const { routes, entry } = await fixture(context);
  await assert.rejects(serveFrozenRoutes({ '/bad': { ...entry, sha256: '0'.repeat(64) } }), /Frozen input mismatch/);
  await assert.rejects(serveFrozenRoutes({ '/bad': { ...entry, bytes: entry.bytes + 1 } }), /Frozen input mismatch/);
  await fs.writeFile(entry.snapshot, 'changed');
  await assert.rejects(serveFrozenRoutes(routes), /Frozen input mismatch/);
});

test('does not serve paths outside the pinned route map', async context => {
  const { routes } = await fixture(context);
  const server = await serveFrozenRoutes(routes);
  context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const suffix of ['/etc/passwd', '/linux/%2e%2e/secret', '/__proto__', '/constructor']) {
    assert.notEqual((await fetch(origin + suffix)).status, 200);
  }
});
