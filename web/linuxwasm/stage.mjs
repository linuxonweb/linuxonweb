#!/usr/bin/env node
// Stage the dev server's static tree (web/desktop, web/linux with the
// web/desktop/latest-build overlay) into ./public for the linuxwasm Worker.
// Packages listed in worker.mjs RELEASE_FILES come from the GitHub release and
// are not staged. Copies use reflinks where the filesystem supports them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FILES } from './release-files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const out = path.join(here, 'public');
const MAX_ASSET = 25 * 1024 * 1024;

// Test fixtures, build leftovers and opt-in or candidate artifacts the page
// never loads by default.
const skip = [
  /(^|\/)(node_modules|__pycache__)(\/|$)/,
  /\.backup-/, /\.(test\.m?js|py)$/,
  /^linux\/precompile\//, /^linux\/packages\/v1\/candidates\//,
  /^desktop\/latest-build\//, /^desktop\/ab-/,
  /^linux\/tests\/(runtime-candidates|.*\/goldens)(\/|$)/,
];
// web/linux/tests also holds runtime host code the page imports
// (gputest.mjs -> tests/guest-gpu/host.mjs and its translators), so its code
// files are kept; its images and fixtures are not. Other tests/ dirs are skipped.
const testsKeep = /\.(mjs|js|wasm|json|html|wgsl|spv)$/;
const released = new Set(Object.keys(RELEASE_FILES).map(p => p.slice(1)));

function* walk(dir, rel = '') {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (skip.some(re => re.test(r))) continue;
    if (/(^|\/)tests(\/|$)/.test(r) && !r.startsWith('linux/tests')) continue;
    if (r.startsWith('linux/tests/') && !ent.isDirectory() && !testsKeep.test(r)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(abs, r);
    else if (ent.isFile() || (ent.isSymbolicLink() && fs.statSync(abs, { throwIfNoEntry: false })?.isFile())) yield [r, abs];
  }
}

const files = new Map();
for (const top of ['desktop', 'linux']) {
  for (const [rel, abs] of walk(path.join(web, top), top)) files.set(rel, abs);
}
const overlay = path.join(web, 'desktop/latest-build');
for (const [rel, abs] of walk(overlay, '')) {
  if (files.has(`linux/${rel}`)) files.set(`linux/${rel}`, abs);
}

fs.rmSync(out, { recursive: true, force: true });
let bytes = 0; let count = 0; const tooBig = [];
for (const [rel, abs] of [...files].sort()) {
  if (released.has(rel)) continue;
  const size = fs.statSync(abs).size;
  if (size > MAX_ASSET) { tooBig.push(`${rel} (${size})`); continue; }
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest, fs.constants.COPYFILE_FICLONE);
  bytes += size; count++;
}
console.log(`staged ${count} files, ${(bytes / 1048576).toFixed(1)} MiB -> ${out}`);
if (tooBig.length) {
  console.error(`over the 25 MiB Worker asset limit and not in RELEASE_FILES:\n  ${tooBig.join('\n  ')}`);
  process.exit(1);
}
