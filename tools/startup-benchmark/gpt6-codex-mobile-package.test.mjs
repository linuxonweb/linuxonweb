import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { stageMobileCandidate } from './gpt6-codex-mobile-package.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const main = `before();
    initramfs = loadDesktopInitramfs(systemAsset(mode === 'firefox' ? 'firefox' : 'plain'), loadDesktopExtras(), {
      gzip: mode === 'firefox',
      preserveGzip: useCompressedInitramfs(mode, location.search, gputestMode || selectedGpuTest === 'software'),
      signal: archiveController.signal,
    });
after();
`;
const worker = `function user_imports({ parent_user: parent }) {
    const HALT_USER = Symbol("halt user");
    let context = parent;
    if (parent) prepare();
    assert(parent);
}
unchangedWorkerCode();
`;
const repairedWorker = worker.replace('    let context = parent;', '    const has_parent = Boolean(parent);\n    let context = parent;').replace('if (parent)', 'if (has_parent)').replace('assert(parent)', 'assert(has_parent)');

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-package-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const routes = {};
  const write = (name, bytes) => {
    const filename = path.join(root, name);
    fs.writeFileSync(filename, bytes);
    return filename;
  };
  const add = (route, name, bytes) => {
    const snapshot = write(name, bytes);
    routes[route] = { snapshot, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  };
  const payload = Buffer.from('same application bytes'.repeat(128));
  const manifest = { schema: 1, bytes: payload.length, sha256: hash(payload), members: [] };
  add('/linux/main.js', 'main.js', main);
  add('/linux/dist/worker.js', 'worker.js', worker);
  add('/linux/desktop-extras.mjs', 'old-helper.mjs', 'oldHelper();');
  add('/linux/desktop-extras.cpio.json', 'old-manifest.json', JSON.stringify(manifest));
  add('/linux/desktop-extras.cpio', 'original.cpio', payload);
  add('/linux/dist/index.js', 'index.js', 'unchangedIndex();');
  add('/linux/initramfs-firefox.cpio.gz', 'root.gz', 'unchanged frozen root');
  const compressed = gzipSync(payload);
  const options = {
    baselinePath: write('baseline.json', JSON.stringify({ routes })), output: path.join(root, 'candidate'),
    helperPath: write('new-helper.mjs', 'newHelper();'), workerPath: write('fixed-worker.js', repairedWorker),
    gzipPath: write('extras.gz', compressed), manifestPath: write('manifest.json', JSON.stringify({ ...manifest, gzip: { bytes: compressed.length, sha256: hash(compressed) } })),
  };
  return { options, routes, root, manifest, write };
}

test('stages only the reviewed loader, isolated worker and packaged gzip delta', async context => {
  const { options, routes } = fixture(context);
  const result = await stageMobileCandidate(options);
  assert.equal(result.runtimeAcceptance, false);
  assert.deepEqual(result.changedRoutes.sort(), ['/linux/main.js', '/linux/desktop-extras.mjs', '/linux/dist/worker.js', '/linux/desktop-extras.cpio.json', '/linux/desktop-extras.cpio.gz'].sort());
  for (const route of ['/linux/dist/index.js', '/linux/initramfs-firefox.cpio.gz', '/linux/desktop-extras.cpio']) assert.deepEqual(result.routes[route], routes[route]);
  const stagedMain = fs.readFileSync(result.routes['/linux/main.js'].snapshot, 'utf8');
  assert.match(stagedMain, /const compressedInitramfs = useCompressedInitramfs\(mode, location.search, gputestMode \|\| selectedGpuTest === 'software'\)/);
  assert.match(stagedMain, /loadDesktopExtras\(fetch, \{ preserveGzip: compressedInitramfs \}\)/);
  assert.match(stagedMain, /compressExtras: compressedInitramfs/);
  assert.ok(stagedMain.startsWith('before();\n') && stagedMain.endsWith('after();\n'));
  assert.equal(fs.readFileSync(result.routes['/linux/dist/worker.js'].snapshot, 'utf8'), repairedWorker);
  assert.equal(fs.readFileSync(routes['/linux/main.js'].snapshot, 'utf8'), main);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.output, 'freeze-receipt.json'))), result);
});

test('unreviewed worker edits and stale input hashes fail before staging', async context => {
  const badWorker = fixture(context);
  fs.appendFileSync(badWorker.options.workerPath, 'activateWorkerPool();');
  await assert.rejects(stageMobileCandidate(badWorker.options), /worker/i);
  assert.equal(fs.existsSync(badWorker.options.output), false);
  const stale = fixture(context);
  fs.appendFileSync(stale.routes['/linux/dist/index.js'].snapshot, 'changed();');
  await assert.rejects(stageMobileCandidate(stale.options), /frozen/i);
  assert.equal(fs.existsSync(stale.options.output), false);
});

test('absent or duplicated loader anchors cannot silently produce another candidate', async context => {
  for (const replacement of [main.replace('loadDesktopExtras()', 'differentLoader()'), main + main]) {
    const { options, routes } = fixture(context);
    const entry = routes['/linux/main.js'];
    fs.writeFileSync(entry.snapshot, replacement);
    entry.bytes = Buffer.byteLength(replacement);
    entry.sha256 = hash(replacement);
    fs.writeFileSync(options.baselinePath, JSON.stringify({ routes }));
    await assert.rejects(stageMobileCandidate(options), /anchor/i);
    assert.equal(fs.existsSync(options.output), false);
  }
});

test('gzip must match both its compressed hash and the unchanged raw manifest', async context => {
  const corrupt = fixture(context);
  fs.appendFileSync(corrupt.options.gzipPath, 'trailing');
  await assert.rejects(stageMobileCandidate(corrupt.options), /gzip/i);
  assert.equal(fs.existsSync(corrupt.options.output), false);
  const substituted = fixture(context);
  const wrong = gzipSync(Buffer.from('substituted application bytes'));
  fs.writeFileSync(substituted.options.gzipPath, wrong);
  fs.writeFileSync(substituted.options.manifestPath, JSON.stringify({ ...substituted.manifest, gzip: { bytes: wrong.length, sha256: hash(wrong) } }));
  await assert.rejects(stageMobileCandidate(substituted.options), /raw|decompress/i);
  assert.equal(fs.existsSync(substituted.options.output), false);
});

test('an existing output is never overwritten', async context => {
  const { options } = fixture(context);
  fs.mkdirSync(options.output);
  fs.writeFileSync(path.join(options.output, 'sentinel'), 'keep');
  await assert.rejects(stageMobileCandidate(options), /exist/i);
  assert.equal(fs.readFileSync(path.join(options.output, 'sentinel'), 'utf8'), 'keep');
});
