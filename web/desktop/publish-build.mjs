#!/usr/bin/env node
// usage: node web/desktop/publish-build.mjs PACKAGE_DIR [--desktop-extras EXTRAS_DIR]
// Copies a verified boot package into the local dev server's latest-build.
// An explicitly supplied extras bundle is verified and retained across later
// Firefox-only publications. Asset bytes precede their manifests; the atomic
// latest-build.json stamp goes last so the dev server restarts after publication.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopExtrasFiles, validateDesktopExtras } from './desktop-extras-package.mjs';

const defaultRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function matches(path, asset) {
  const info = await stat(path).catch(() => null);
  return !!info && info.isFile() && info.size === asset.bytes && await sha256(path) === asset.sha256;
}

export async function publishBuild(source, { extrasSource = null, root = defaultRoot } = {}) {
  source = resolve(source);
  const latest = join(root, 'web/desktop/latest-build');
  const repoLinux = join(root, 'web/linux');
  const report = JSON.parse(await readFile(join(source, 'package.json'), 'utf8').catch(() => '{}'));
  if (report.passPackage !== true) throw new Error(source + '/package.json does not report passPackage');
  const manifestBytes = await readFile(join(source, 'boot-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const plan = new Map([['boot-manifest.json', {
    source: join(source, 'boot-manifest.json'), bytes: manifestBytes.length, sha256: hashBytes(manifestBytes),
  }]]);
  for (const [name, asset] of Object.entries(manifest.assets)) {
    const file = basename(asset.url);
    if (existsSync(join(source, file))) {
      if (!await matches(join(source, file), asset)) throw new Error(file + ' in the package does not match the manifest');
      plan.set(file, { source: join(source, file), bytes: asset.bytes, sha256: asset.sha256 });
    } else if (!await matches(join(repoLinux, file), asset)) {
      throw new Error('manifest asset ' + name + ' (' + file + ') is neither in the package nor matching web/linux');
    }
  }
  const previous = JSON.parse(await readFile(join(latest, 'latest-build.json'), 'utf8').catch(() => '{"files":[]}'));
  if (!Array.isArray(previous.files)) throw new Error('Previously published files must be an array');
  for (const file of previous.files) {
    if (typeof file !== 'string' || file !== basename(file) || file === '.' || file === '..') {
      throw new Error('Invalid previously published filename');
    }
  }
  let desktopExtras = null;
  if (extrasSource || previous.desktopExtras) {
    const directory = extrasSource ? resolve(extrasSource) : latest;
    if (!extrasSource && (!previous.desktopExtras.files || typeof previous.desktopExtras.files !== 'object')) {
      throw new Error('Previously published extras lack their file pins');
    }
    const verified = await validateDesktopExtras(directory, extrasSource ? null : previous.desktopExtras.files);
    desktopExtras = { source: extrasSource ? directory : previous.desktopExtras.source, files: verified.files };
    for (const file of desktopExtrasFiles) {
      if (plan.has(file)) throw new Error('Boot package and extras bundle name the same file: ' + file);
      plan.set(file, { source: join(directory, file), ...verified.files[file] });
    }
  }

  const files = [...plan.keys()];
  const id = String(manifest.version);
  await mkdir(latest, { recursive: true });
  const incoming = await mkdtemp(join(latest, '.incoming-'));
  try {
    for (const [file, asset] of plan) {
      await copyFile(asset.source, join(incoming, file));
      if (!await matches(join(incoming, file), asset)) throw new Error('Package file changed while staging: ' + file);
    }
    // Metadata is installed only after all the bytes it names are staged.
    const extrasManifest = desktopExtras ? [desktopExtrasFiles[2]] : [];
    const order = [...files.filter(file => file !== 'boot-manifest.json' && !extrasManifest.includes(file)),
      ...extrasManifest, 'boot-manifest.json'];
    for (const file of order) await rename(join(incoming, file), join(latest, file));
    for (const file of previous.files) if (!files.includes(file)) await rm(join(latest, file), { force: true });
    const stamp = { id, source, published: new Date().toISOString(), files };
    if (desktopExtras) stamp.desktopExtras = desktopExtras;
    await writeFile(join(incoming, 'latest-build.json'), JSON.stringify(stamp, null, 1) + '\n');
    await rename(join(incoming, 'latest-build.json'), join(latest, 'latest-build.json'));
    return stamp;
  } finally {
    await rm(incoming, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 1 || (args.length === 3 && args[1] === '--desktop-extras'))) {
    console.error('usage: publish-build.mjs PACKAGE_DIR [--desktop-extras EXTRAS_DIR]');
    process.exitCode = 2;
  } else {
    const stamp = await publishBuild(args[0], { extrasSource: args[2] });
    console.log('published build ' + stamp.id + ' from ' + stamp.source + ': ' + stamp.files.join(', '));
  }
}
