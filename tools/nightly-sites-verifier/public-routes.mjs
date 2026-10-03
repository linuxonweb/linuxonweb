import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { checkExpectations, sha, HASH } from './contract.mjs';
import { verifyPublicHTML, challengeTemplateSHA256 } from './public-html-policy.mjs';

const isolation = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin', 'x-content-type-options': 'nosniff' };
const isolated = response => { for (const [key, value] of Object.entries(isolation)) assert.equal(response.headers.get(key), value, key); };
function metadata(response, path, entry, transformed = false) {
  isolated(response); assert.equal(response.headers.get('etag'), transformed ? null : '"' + entry.sha256 + '"', path);
  assert.equal(response.headers.get('content-type'), entry.contentType, path); assert.equal(response.headers.get('accept-ranges'), 'bytes', path);
  assert.equal(response.headers.get('cache-control'), entry.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate', path);
  if (transformed) assert.equal(response.headers.get('content-length'), null, path);
  else if (!response.headers.has('content-encoding')) assert.equal(Number(response.headers.get('content-length')), entry.size, path);
}

// Injected request is for host fixtures. CLI uses fetch against the exact existing
// HTTPS origin; this function never starts a server, browser, guest or deployment.
export async function verifyPublicRoutes({ expected: e, dist, request: injectedRequest }) {
  checkExpectations(e); const root = await realpath(dist), client = await realpath(resolve(root, 'client'));
  const origin = new URL(e.origin); const report = { schema: 1, origin: e.origin, parentCommit: e.rootCommit, workerGraphSHA256: e.workerGraphSHA256, assetsSHA256: e.dist.assetsSHA256, challengeTemplateSHA256, expectedRouteCount: 0, routes: [], checks: [], failures: [], complete: false, releaseAcceptance: false };
  const request = injectedRequest ?? ((path, init = {}) => fetch(new URL(path, origin), { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(180000), ...init, headers: { 'Accept-Encoding': 'identity', ...init.headers } }));
  async function pinnedJSON(name, hash) { const bytes = await readFile(resolve(root, name)); assert.equal(sha(bytes), hash, 'reviewed ' + name); return JSON.parse(bytes); }
  async function safePart(path) { assert.ok(path.startsWith('/') && !path.includes('..') && !path.includes('\\') && !path.includes('?') && !path.includes('#')); const file = await realpath(resolve(client, '.' + path)); assert.ok(!relative(client, file).startsWith('..')); return file; }
  let assets;
  try {
    assets = await pinnedJSON('runtime-assets.json', e.dist.assetsSHA256);
    assert.deepEqual(Object.fromEntries(Object.entries(assets).map(([path, entry]) => [path, { sha256: entry.sha256, size: entry.size }])), e.dist.routeInventory, 'complete reviewed route inventory');
    const graph = await pinnedJSON('worker-graph-build.json', e.dist.graphSHA256);
    const provenance = await pinnedJSON('release-provenance.json', e.dist.provenanceSHA256);
    assert.equal(graph.parentCommit, e.rootCommit); assert.equal(graph.graphSHA256, e.workerGraphSHA256);
    assert.equal(provenance.parentCommit, e.rootCommit, 'root P provenance');
    const rootBytes = await readFile(resolve(client, 'index.html')); assert.equal(sha(rootBytes), e.dist.rootHTMLSHA256, 'reviewed static root');
    const localBytes = async path => Buffer.concat(await Promise.all(assets[path].parts.map(async part => { const bytes = await readFile(await safePart(part.path)); assert.equal(bytes.length, part.size); assert.ok(part.size <= 20 * 1024 * 1024); return bytes; })));
    const manifestBytes = await localBytes('/linux/boot-manifest.json'); assert.equal(sha(manifestBytes), assets['/linux/boot-manifest.json'].sha256);
    const manifest = JSON.parse(manifestBytes); assert.equal(manifest.version, e.runtime);
    for (const [name, image] of Object.entries(e.images)) { assert.equal(manifest.assets[name].sha256, image.sha256); assert.equal(manifest.assets[name].bytes, image.bytes); const url = new URL(manifest.assets[name].url, new URL('/linux/boot-manifest.json', origin)); assert.equal(url.origin, origin.origin); assert.equal(url.pathname, image.path); assert.equal(assets[image.path].sha256, image.sha256); assert.equal(assets[image.path].size, image.bytes); }
    report.bootManifest = manifest; report.expectedRouteCount = Object.keys(assets).length;
    assert.ok(report.expectedRouteCount > 0);
    for (const [path, entry] of Object.entries(assets)) {
      assert.match(entry.sha256, HASH); assert.ok(path.startsWith('/') && !path.includes('..') && !path.includes('?') && !path.includes('#'));
      assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0 && entry.parts.length > 0);
      // Hash every staged logical route, including immutable derived worker routes.
      const localHash = createHash('sha256'); let localSize = 0;
      for (const part of entry.parts) { const bytes = await readFile(await safePart(part.path)); assert.equal(bytes.length, part.size); assert.ok(part.size <= 20 * 1024 * 1024); localHash.update(bytes); localSize += bytes.length; }
      assert.equal(localSize, entry.size, path); assert.equal(localHash.digest('hex'), entry.sha256, path);
      const response = await request(path); assert.equal(response.status, 200, path);
      if (['/desktop/index.html', '/linux/index.html'].includes(path)) { const html = verifyPublicHTML(path, Buffer.from(await response.arrayBuffer()), await localBytes(path)); assert.equal(html.normalizedSHA256, entry.sha256); assert.equal(html.normalizedSize, entry.size); metadata(response, path, entry, html.transformed); report.routes.push({ path, status: 200, ...html }); }
      else { metadata(response, path, entry); const hash = createHash('sha256'); let size = 0; for await (const bytes of response.body) { hash.update(bytes); size += bytes.byteLength; } const digest = hash.digest('hex'); assert.equal(size, entry.size, path); assert.equal(digest, entry.sha256, path); report.routes.push({ path, status: 200, size, sha256: digest }); }
    }
    for (const image of Object.values(e.images)) {
      const path = image.path, entry = assets[path], head = await request(path, { method: 'HEAD' }); assert.equal(head.status, 200); metadata(head, path, entry); assert.equal((await head.arrayBuffer()).byteLength, 0);
      const conditional = await request(path, { headers: { 'If-None-Match': '"' + entry.sha256 + '"' } }); assert.equal(conditional.status, 304); isolated(conditional); assert.equal((await conditional.arrayBuffer()).byteLength, 0);
      const boundary = entry.parts.length > 1 ? entry.parts[0].size : Math.min(32, entry.size - 1);
      const start = Math.max(0, boundary - 1), end = Math.min(entry.size - 1, boundary + 1), range = await request(path, { headers: { Range: `bytes=${start}-${end}` } });
      assert.equal(range.status, 206); isolated(range); assert.equal(range.headers.get('content-range'), `bytes ${start}-${end}/${entry.size}`);
      // Only retain enough local parts to compare this bounded range.
      const bytes = Buffer.concat(await Promise.all(entry.parts.slice(0, 2).map(async p => readFile(await safePart(p.path)))));
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(start, end + 1));
      report.checks.push(path + ': HEAD, ETag/304, exact range' + (entry.parts.length > 1 ? ' crossing part boundary' : ' single-part'));
    }
    assert.ok(assets[e.images.firefox.path].parts.length > 1, 'full Firefox multipart range coverage required');
    const rootResponse = await request('/?check=1'); assert.equal(rootResponse.status, 200, 'reviewed built static root'); assert.equal(rootResponse.headers.get('content-type'), 'text/html'); assert.equal(rootResponse.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.ok(rootBytes.toString().includes('content="0;url=/linux/index.html?firefox=1"'));
    const html = verifyPublicHTML('/', Buffer.from(await rootResponse.arrayBuffer()), rootBytes); assert.equal(rootResponse.headers.get('cross-origin-opener-policy'), null, 'static root has no COOP');
    assert.equal(rootResponse.headers.get('etag'), html.transformed ? null : '"' + e.dist.rootHTMLSHA256 + '"');
    if (html.transformed) assert.equal(rootResponse.headers.get('content-length'), null);
    report.root = { status: 200, ...html, isolated: false, landing: '/linux/index.html?firefox=1', landingIsolationVerifiedInRoutes: true };
    for (const path of ['/linux/tests/guest-graphics.html', '/linux/tests/runtime-candidates/unaccepted/boot-manifest.json', '/source/private', '/_runtime_worker/' + '0'.repeat(64) + '/linux/dist/worker.js']) { const response = await request(path); assert.equal(response.status, 404, path); isolated(response); await response.body?.cancel(); }
    report.checks.push('rejected fixture, candidate, source and wrong worker graph'); report.complete = true;
  } catch (error) { report.failures.push({ name: error.name, message: error.message }); }
  return report;
}
