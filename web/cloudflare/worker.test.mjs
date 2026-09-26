import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { readFile, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assets from './generated/asset-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(await readFile(resolve(here, 'generated/build-report.json')));
const origin = 'http://linuxonweb.test';
let runtime;
before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    name: 'linuxonweb-test', compatibilityDate: '2026-09-26',
    modules: ['worker.mjs', 'generated/asset-manifest.mjs'].map(path => ({ type: 'ESModule', path: resolve(here, path) })),
    assets: {
      directory: resolve(here, 'public'), binding: 'ASSETS', run_worker_first: true,
      routerConfig: { has_user_worker: true },
      assetConfig: { html_handling: 'none', not_found_handling: 'none' },
    },
  }));
  await runtime.ready;
});
after(async () => { await runtime?.dispose(); });
const request = (path, init = {}) => runtime.dispatchFetch(origin + path, { redirect: 'manual', ...init });
function isolated(response) {
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
}

test('root enables Firefox and preserves query; static HTML and errors are isolated', async () => {
  for (const [path, location] of [['/', '/linux/index.html?firefox=1'], ['/?foo=bar&firefox=0', '/linux/index.html?foo=bar&firefox=0']]) {
    const response = await request(path);
    assert.equal(response.status, 302); assert.equal(response.headers.get('Location'), location); isolated(response);
  }
  for (const path of ['/linux', '/linux/', '/linux/index.html', '/desktop/']) {
    const response = await request(path); assert.equal(response.status, 200); isolated(response);
    assert.match(await response.text(), /<!doctype html>/i);
  }
  const missing = await request('/secret'); assert.equal(missing.status, 404); isolated(missing);
  assert.equal((await request('/dns', { method: 'POST' })).status, 405);
});

test('DNS rejects invalid/private names and unauthorized origins', async () => {
  for (const name of ['', '127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '2130706433', '0177.0.0.1', 'localhost', 'service.internal', 'a.invalid', 'a..com']) {
    const response = await request('/dns?name=' + encodeURIComponent(name)); assert.equal(response.status, 400, name); isolated(response);
  }
  assert.equal((await request('/dns?name=1.1.1.1', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const response = await request('/dns?name=1.1.1.1', { headers: { Origin: origin } });
  assert.deepEqual(await response.json(), { addresses: ['1.1.1.1'] });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('TCP rejects absent upgrade/origin and private destinations before connecting', async () => {
  assert.equal((await request('/tcp?host=1.1.1.1&port=443')).status, 426);
  for (const headers of [{ Upgrade: 'websocket' }, { Upgrade: 'websocket', Origin: 'https://evil.example' }]) {
    assert.equal((await request('/tcp?host=1.1.1.1&port=443', { headers })).status, 403);
  }
  for (const query of ['host=127.0.0.1&port=80', 'host=10.0.0.1&port=80', 'host=192.168.1.1&port=80', 'host=1.1.1.1&port=25', 'host=1.1.1.1&port=0', 'host=1.1.1.1&port=65536', 'host=1.1.1.1&port=1e2', 'host=localhost&port=80']) {
    const response = await request('/tcp?' + query, { headers: { Upgrade: 'websocket', Origin: origin } });
    assert.equal(response.status, 400, query); isolated(response);
  }
});

test('every staged source serves exact length and SHA-256 including multipart archives', async () => {
  for (const source of report.sourceFiles) {
    const head = await request(source.path, { method: 'HEAD' });
    assert.equal(head.status, 200, source.path); isolated(head);
    assert.equal(Number(head.headers.get('Content-Length')), source.size, source.path);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const response = await request(source.path); assert.equal(response.status, 200, source.path);
    const hash = createHash('sha256'); let size = 0;
    for await (const bytes of response.body) { size += bytes.byteLength; hash.update(bytes); }
    assert.equal(size, source.size, source.path); assert.equal(hash.digest('hex'), source.sha256, source.path);
    const cached = await request(source.path, { headers: { 'If-None-Match': head.headers.get('ETag') } });
    assert.equal(cached.status, 304); assert.equal((await cached.arrayBuffer()).byteLength, 0);
  }
});

test('multipart ranges cross boundaries and match staged bytes; malformed ranges fail', async () => {
  for (const source of report.sourceFiles.filter(source => source.parts > 1)) {
      for (const [start, end, range] of [[0, 1023, 'bytes=0-1023'], [report.chunkSize - 512, report.chunkSize + 511, `bytes=${report.chunkSize - 512}-${report.chunkSize + 511}`], [source.size - 1024, source.size - 1, 'bytes=-1024'], [source.size - 512, source.size - 1, `bytes=${source.size - 512}-`]]) {
        const response = await request(source.path, { headers: { Range: range } });
        assert.equal(response.status, 206); isolated(response);
        assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/${source.size}`);
        assert.equal(Number(response.headers.get('Content-Length')), end - start + 1);
        // Compare the immutable staging snapshot; source archives can be rebuilt
        // independently while this deployed snapshot is under validation.
        const expected = Buffer.alloc(end - start + 1); let offset = 0;
        for (const part of assets[source.path].parts) {
          const lo = Math.max(start, offset), hi = Math.min(end + 1, offset + part.size);
          if (hi > lo) {
            const file = await open(resolve(here, 'public', '.' + part.path));
            try { const { bytesRead } = await file.read(expected, lo - start, hi - lo, lo - offset); assert.equal(bytesRead, hi - lo); }
            finally { await file.close(); }
          }
          offset += part.size;
        }
        assert.ok(Buffer.from(await response.arrayBuffer()).equals(expected), `${source.path} ${range}: bytes differ from staging`);
      }
      for (const range of ['bytes=1-0', 'bytes=-0', 'bytes=0-1,5-6', `bytes=${source.size}-`]) {
        const response = await request(source.path, { headers: { Range: range } }); assert.equal(response.status, 416);
      }
  }
});

test('single-part JavaScript and wasm ranges match staged assets', async () => {
  for (const path of ['/linux/main.js', '/linux/vmlinux.wasm']) {
    const entry = assets[path]; const source = await readFile(resolve(here, 'public', '.' + entry.parts[0].path));
    for (const [range, start, end] of [['bytes=17-1040', 17, 1040], ['bytes=-128', entry.size - 128, entry.size - 1]]) {
      const response = await request(path, { headers: { Range: range } });
      assert.equal(response.status, 206); isolated(response);
      assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/${entry.size}`);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(source.subarray(start, end + 1)), `${path} ${range}`);
    }
  }
});

test('live Bing DNS resolves public A records', { skip: process.env.NETWORK_TESTS !== '1' }, async () => {
  const response = await request('/dns?name=www.bing.com'); assert.equal(response.status, 200);
  const result = await response.json(); assert.ok(result.addresses.length); assert.ok(result.addresses.every(address => /^\d+\.\d+\.\d+\.\d+$/.test(address)));
});

test('live binary WebSocket forwards TCP HTTP bytes', { skip: process.env.NETWORK_TESTS !== '1', timeout: 25000 }, async () => {
  const response = await request('/tcp?host=www.bing.com&port=80', { headers: { Upgrade: 'websocket', Origin: origin } });
  assert.equal(response.status, 101); const socket = response.webSocket; socket.accept();
  try {
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TCP HTTP response timeout')), 20000);
      socket.addEventListener('message', event => { clearTimeout(timer); resolve(Buffer.from(event.data)); }, { once: true });
      socket.addEventListener('close', event => { clearTimeout(timer); reject(new Error(`TCP closed ${event.code}: ${event.reason}`)); }, { once: true });
    });
    socket.send(new TextEncoder().encode('GET / HTTP/1.1\r\nHost: www.bing.com\r\nConnection: close\r\n\r\n'));
    assert.match((await received).toString(), /^HTTP\/1\.[01] [1-5]\d\d/);
  } finally { socket.close(); }
});

test('live WebSocket transports client TLS to Google with certificate verification', { skip: process.env.NETWORK_TESTS !== '1', timeout: 25000 }, async () => {
  const response = await request('/tcp?host=www.google.com&port=443', { headers: { Upgrade: 'websocket', Origin: origin } });
  assert.equal(response.status, 101); const socket = response.webSocket; socket.accept();
  const transport = new Duplex({
    read() {},
    write(bytes, encoding, callback) { try { socket.send(bytes); callback(); } catch (error) { callback(error); } },
    destroy(error, callback) { try { socket.close(); } catch {} callback(error); },
  });
  socket.addEventListener('message', event => transport.push(Buffer.from(event.data)));
  socket.addEventListener('close', () => transport.push(null));
  socket.addEventListener('error', () => transport.destroy(new Error('WebSocket transport error')));
  const tls = tlsConnect({ socket: transport, servername: 'www.google.com', rejectUnauthorized: true });
  try {
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TLS HTTP response timeout')), 20000);
      tls.once('error', error => { clearTimeout(timer); reject(error); });
      tls.once('secureConnect', () => tls.write('GET / HTTP/1.1\r\nHost: www.google.com\r\nConnection: close\r\n\r\n'));
      tls.once('data', bytes => { clearTimeout(timer); resolve(bytes); });
    });
    assert.match((await received).toString(), /^HTTP\/1\.[01] [1-5]\d\d/);
    assert.equal(tls.authorized, true);
  } finally { tls.destroy(); transport.destroy(); }
});
