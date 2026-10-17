import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Expected unique candidate anchor');
  return source.replace(before, after);
}

export async function stageMobileCandidate({ baselinePath, output, helperPath, workerPath, gzipPath, manifestPath }) {
  if (fs.existsSync(output)) throw Error('Candidate output already exists');
  const baselineBytes = fs.readFileSync(baselinePath);
  const baseline = JSON.parse(baselineBytes);
  if (!baseline.routes || typeof baseline.routes !== 'object') throw Error('Missing frozen routes');
  for (const [route, entry] of Object.entries(baseline.routes)) {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of fs.createReadStream(entry.snapshot)) { hash.update(chunk); bytes += chunk.length; }
    if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) throw Error('Frozen input mismatch: ' + route);
  }
  const read = route => fs.readFileSync(baseline.routes[route].snapshot, 'utf8');
  let main = read('/linux/main.js');
  main = replaceOnce(main,
    "    initramfs = loadDesktopInitramfs(systemAsset(mode === 'firefox' ? 'firefox' : 'plain'), loadDesktopExtras(), {",
    "    const compressedInitramfs = useCompressedInitramfs(mode, location.search, gputestMode || selectedGpuTest === 'software');\n    initramfs = loadDesktopInitramfs(systemAsset(mode === 'firefox' ? 'firefox' : 'plain'), loadDesktopExtras(fetch, { preserveGzip: compressedInitramfs }), {");
  main = replaceOnce(main,
    "      preserveGzip: useCompressedInitramfs(mode, location.search, gputestMode || selectedGpuTest === 'software'),",
    '      preserveGzip: compressedInitramfs,\n      compressExtras: compressedInitramfs,');
  let expectedWorker = read('/linux/dist/worker.js');
  expectedWorker = replaceOnce(expectedWorker, '    let context = parent;', '    const has_parent = Boolean(parent);\n    let context = parent;');
  expectedWorker = replaceOnce(expectedWorker, 'if (parent)', 'if (has_parent)');
  expectedWorker = replaceOnce(expectedWorker, 'assert(parent)', 'assert(has_parent)');
  const worker = fs.readFileSync(workerPath, 'utf8');
  if (worker !== expectedWorker) throw Error('Unreviewed worker delta');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const { gzip, ...rawManifest } = manifest;
  assert.deepEqual(rawManifest, JSON.parse(read('/linux/desktop-extras.cpio.json')), 'Raw extras manifest changed');
  const rawRoute = baseline.routes['/linux/desktop-extras.cpio'];
  if (manifest.schema !== 1 || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 64 * 1024 ** 2 || rawRoute.bytes !== manifest.bytes || rawRoute.sha256 !== manifest.sha256) throw Error('Invalid raw extras binding');
  if (!gzip || !Number.isSafeInteger(gzip.bytes) || gzip.bytes < 18 || gzip.bytes > manifest.bytes + 65536 || !/^[0-9a-f]{64}$/.test(gzip.sha256)) throw Error('Invalid gzip metadata');
  const compressed = fs.readFileSync(gzipPath);
  if (compressed.length !== gzip.bytes || digest(compressed) !== gzip.sha256) throw Error('Extras gzip identity mismatch');
  const expanded = gunzipSync(compressed, { maxOutputLength: manifest.bytes });
  if (expanded.length !== manifest.bytes || digest(expanded) !== manifest.sha256) throw Error('Decompressed raw extras mismatch');
  const helper = fs.readFileSync(helperPath);
  if (helper.includes(Buffer.from('jit-control-probe'))) throw Error('Candidate helper must be uninstrumented');
  const assets = [
    ['/linux/main.js', 'main.js', Buffer.from(main)],
    ['/linux/desktop-extras.mjs', 'desktop-extras.mjs', helper],
    ['/linux/dist/worker.js', 'worker.js', Buffer.from(worker)],
    ['/linux/desktop-extras.cpio.json', 'desktop-extras.cpio.json', manifestBytes],
    ['/linux/desktop-extras.cpio.gz', 'desktop-extras.cpio.gz', compressed],
  ];
  const routes = structuredClone(baseline.routes);
  fs.mkdirSync(output, { mode: 0o700 });
  for (const [route, filename, bytes] of assets) {
    const snapshot = path.resolve(output, filename);
    fs.writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o444 });
    routes[route] = { snapshot, bytes: bytes.length, sha256: digest(bytes) };
  }
  const receipt = {
    schema: 1, baselineSha256: digest(baselineBytes), routes,
    changedRoutes: assets.map(([route]) => route).sort(),
    isolatedWorker: true, rawExtrasPreserved: true, runtimeAcceptance: false,
  };
  fs.writeFileSync(path.join(output, 'freeze-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
  return receipt;
}
