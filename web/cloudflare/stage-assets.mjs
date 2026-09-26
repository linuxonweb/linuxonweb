#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const chunkSize = 20 * 1024 * 1024;
const temporary = join(here, '.stage-tmp');
const publicDir = join(temporary, 'public');
const generatedDir = join(temporary, 'generated');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm' };
const sources = new Map();

function include(source, url) {
  if (sources.has(url)) throw new Error(`Duplicate public route: ${url}`);
  sources.set(url, join(root, source));
}
async function includeModules(directory) {
  for (const item of (await readdir(join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) await includeModules(path);
    else if (item.isFile() && /\.(?:js|mjs)$/.test(item.name) && !/\.test\./.test(item.name)) include(path, path.slice(3));
  }
}

// Explicit allowlist: never copy the source tree, backups, tests, or arbitrary node_modules.
for (const name of ['index.html', 'main.js', 'keyboard.mjs', 'mobile-keyboard.mjs', 'touch-gesture.mjs', 'log-viewer.mjs', 'vmlinux.wasm', 'initramfs.cpio', 'initramfs-firefox.cpio.gz', 'node_modules/@xterm/xterm/css/xterm.css', 'node_modules/@xterm/xterm/lib/xterm.js', 'node_modules/@xterm/addon-fit/lib/addon-fit.js']) include(`web/linux/${name}`, `/linux/${name}`);
await includeModules('web/linux/dist');
for (const name of ['index.html', 'browser-posix-websocket.js', 'aurora-runner.js', 'xvfb-runner.js', 'artifacts/xvfb/Xvfb.js', 'artifacts/xvfb/Xvfb.wasm', 'artifacts/xvfb/Xvfb.data', 'artifacts/aurora/aurora-wm.js', 'artifacts/aurora/aurora-wm.wasm']) include(`web/desktop/${name}`, `/desktop/${name}`);

await rm(temporary, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });
const assets = {};
const uploadManifest = {};
const report = { chunkSize, sourceFiles: [], sourceBytes: 0, stagedFiles: 0, stagedBytes: 0, routes: 0, largeFiles: 0 };

async function stagePart(path, bytes) {
  if (bytes.length > chunkSize) throw new Error(`Oversized staged asset: ${path}`);
  const target = join(publicDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  uploadManifest[path] = { hash: createHash('md5').update(bytes).digest('hex'), size: bytes.length };
  report.stagedFiles++;
  report.stagedBytes += bytes.length;
  return { path, size: bytes.length };
}

for (const [url, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
  const before = await stat(source);
  if (!before.isFile()) throw new Error(`Runtime asset is not a regular file: ${source}`);
  const handle = await open(source, 'r');
  const hash = createHash('sha256');
  const temporaryParts = [];
  const parts = [];
  try {
    let offset = 0;
    while (offset < before.size) {
      const bytes = Buffer.allocUnsafe(Math.min(chunkSize, before.size - offset));
      let filled = 0;
      while (filled < bytes.length) {
        const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, offset + filled);
        if (!bytesRead) throw new Error(`Runtime asset changed while staging: ${source}`);
        filled += bytesRead;
      }
      hash.update(bytes);
      if (before.size <= chunkSize) parts.push(await stagePart(url, bytes));
      else {
        const tempPath = join(temporary, `part-${temporaryParts.length}`);
        await writeFile(tempPath, bytes);
        temporaryParts.push({ tempPath, size: bytes.length, hash: createHash('md5').update(bytes).digest('hex') });
      }
      offset += bytes.length;
    }
    if (before.size === 0) parts.push(await stagePart(url, Buffer.alloc(0)));
  } finally { await handle.close(); }
  const after = await stat(source);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error(`Runtime asset changed while staging: ${source}`);
  const sha256 = hash.digest('hex');
  for (const [index, part] of temporaryParts.entries()) {
    const path = `/__chunks/${sha256}/${index}`;
    const target = join(publicDir, path);
    await mkdir(dirname(target), { recursive: true });
    await rename(part.tempPath, target);
    uploadManifest[path] = { hash: part.hash, size: part.size };
    parts.push({ path, size: part.size });
    report.stagedFiles++;
    report.stagedBytes += part.size;
  }
  assets[url] = { size: before.size, sha256, contentType: mime[extname(source)] || 'application/octet-stream', parts };
  report.sourceFiles.push({ source: relative(root, source), path: url, size: before.size, sha256, parts: parts.length });
  report.sourceBytes += before.size;
  if (parts.length > 1) report.largeFiles++;
}

// Legacy dev-server aliases reuse canonical assets without uploading duplicate bytes.
for (const [path, asset] of Object.entries(assets)) {
  if (path.startsWith('/desktop/artifacts/')) assets[path.replace('/desktop/artifacts/', '/upstream/')] = asset;
}
for (const name of ['browser-posix-websocket.js', 'aurora-runner.js', 'xvfb-runner.js']) assets[`/upstream/${name}`] = assets[`/desktop/${name}`];
report.routes = Object.keys(assets).length;
const orderedAssets = Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(join(generatedDir, 'asset-manifest.mjs'), `// Generated by stage-assets.mjs. Do not edit.\nexport default ${JSON.stringify(orderedAssets, null, 2)};\n`);
await writeFile(join(generatedDir, 'upload-manifest.json'), `${JSON.stringify(uploadManifest, null, 2)}\n`);
await writeFile(join(generatedDir, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const name of ['public', 'generated']) {
  await rm(join(here, name), { recursive: true, force: true });
  await rename(join(temporary, name), join(here, name));
}
await rm(temporary, { recursive: true, force: true });
console.log(JSON.stringify({ sourceFiles: report.sourceFiles.length, routes: report.routes, sourceBytes: report.sourceBytes, stagedFiles: report.stagedFiles, stagedBytes: report.stagedBytes, largeFiles: report.largeFiles, maxAssetBytes: Math.max(...Object.values(uploadManifest).map(file => file.size)) }, null, 2));
