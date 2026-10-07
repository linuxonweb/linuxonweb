#!/usr/bin/env node
// usage: node web/desktop/publish-build.mjs PACKAGE_DIR
// Copies a built boot package (boot-manifest.json plus the assets it names that
// the package contains) into web/desktop/latest-build, where the dev server
// serves them in place of the repo copies under /linux/. Every manifest asset is
// checked first: package files and repo files must match the pinned size and
// sha256. latest-build.json is written last; dev-server.mjs restarts on it.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const latest = join(root, 'web/desktop/latest-build');
const repoLinux = join(root, 'web/linux');

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function matches(path, asset) {
  const info = await stat(path).catch(() => null);
  return !!info && info.size === asset.bytes && await sha256(path) === asset.sha256;
}

const source = process.argv[2] && resolve(process.argv[2]);
if (!source) { console.error('usage: publish-build.mjs PACKAGE_DIR'); process.exit(2); }
const report = JSON.parse(await readFile(join(source, 'package.json'), 'utf8').catch(() => '{}'));
if (report.passPackage !== true) throw new Error(`${source}/package.json does not report passPackage`);
const manifest = JSON.parse(await readFile(join(source, 'boot-manifest.json'), 'utf8'));

const files = ['boot-manifest.json'];
for (const [name, asset] of Object.entries(manifest.assets)) {
  const file = basename(asset.url);
  if (existsSync(join(source, file))) {
    if (!await matches(join(source, file), asset)) throw new Error(`${file} in the package does not match the manifest`);
    files.push(file);
  } else if (!await matches(join(repoLinux, file), asset)) {
    throw new Error(`manifest asset ${name} (${file}) is neither in the package nor matching web/linux`);
  }
}

const id = String(manifest.version);
const incoming = join(latest, `.incoming-${id}`);
await rm(incoming, { recursive: true, force: true });
await mkdir(incoming, { recursive: true });
for (const file of files) await copyFile(join(source, file), join(incoming, file));
const previous = JSON.parse(await readFile(join(latest, 'latest-build.json'), 'utf8').catch(() => '{"files":[]}'));
// The manifest goes last so a page never sees a manifest naming missing bytes.
for (const file of [...files.filter(file => file !== 'boot-manifest.json'), 'boot-manifest.json']) await rename(join(incoming, file), join(latest, file));
await rm(incoming, { recursive: true, force: true });
for (const file of previous.files ?? []) if (!files.includes(file)) await rm(join(latest, file), { force: true });
await writeFile(join(latest, 'latest-build.json'), JSON.stringify({ id, source, published: new Date().toISOString(), files }, null, 1) + '\n');
console.log(`published build ${id} from ${source}: ${files.join(', ')}`);
