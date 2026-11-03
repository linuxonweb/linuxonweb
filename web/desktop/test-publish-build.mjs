import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { desktopExtrasFiles, validateDesktopExtras } from './desktop-extras-package.mjs';
import { publishBuild } from './publish-build.mjs';

const digest = body => createHash('sha256').update(body).digest('hex');
function newc(name, mode, body) {
  const nameBytes = Buffer.from(name + '\0');
  const fields = [1, mode, 0, 0, 1, 0, body.length, 0, 0, 0, 0, nameBytes.length, 0];
  const header = Buffer.from('070701' + fields.map(value => value.toString(16).padStart(8, '0')).join(''));
  return Buffer.concat([header, nameBytes, Buffer.alloc(-(header.length + nameBytes.length) & 3),
    body, Buffer.alloc(-body.length & 3)]);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'extras-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linux = join(root, 'web/linux');
  const latest = join(root, 'web/desktop/latest-build');
  const extras = join(root, 'extras');
  await Promise.all([mkdir(linux, { recursive: true }), mkdir(latest, { recursive: true }), mkdir(extras)]);
  const kernel = Buffer.from('fixture kernel');
  await writeFile(join(linux, 'kernel.wasm'), kernel);
  async function boot(version) {
    const source = join(root, 'package-' + version);
    await mkdir(source);
    const system = Buffer.from('fixture system ' + version);
    const manifest = { schema: 1, version, assets: {
      kernel: { url: './kernel.wasm', bytes: kernel.length, sha256: digest(kernel) },
      system: { url: './system.cpio.gz', bytes: system.length, sha256: digest(system) },
    } };
    await Promise.all([
      writeFile(join(source, 'package.json'), JSON.stringify({ passPackage: true })),
      writeFile(join(source, 'boot-manifest.json'), JSON.stringify(manifest)),
      writeFile(join(source, 'system.cpio.gz'), system),
    ]);
    return source;
  }
  const app = Buffer.from('\0asm\x01\0\0\0');
  const alias = Buffer.from('app');
  const unpadded = Buffer.concat([
    newc('bin', 0o40755, Buffer.alloc(0)), newc('bin/app', 0o100755, app),
    newc('bin/alias', 0o120777, alias), newc('TRAILER!!!', 0, Buffer.alloc(0)),
  ]);
  const raw = Buffer.concat([unpadded, Buffer.alloc(-unpadded.length & 511)]);
  const compressed = gzipSync(raw);
  const metadata = { schema: 1, bytes: raw.length, sha256: digest(raw), members: [
    { path: '/bin/app', bytes: app.length, sha256: digest(app) },
    { path: '/bin/alias', bytes: alias.length, sha256: digest(alias) },
  ], provenance: 'preserved fixture metadata',
  gzip: { bytes: compressed.length, sha256: digest(compressed) } };
  await Promise.all([
    writeFile(join(extras, desktopExtrasFiles[0]), raw),
    writeFile(join(extras, desktopExtrasFiles[1]), compressed),
    writeFile(join(extras, desktopExtrasFiles[2]), JSON.stringify(metadata)),
  ]);
  return { root, latest, extras, raw, metadata, boot };
}

test('ordinary publication stays compatible and explicit extras survive Firefox-only updates', async t => {
  const f = await fixture(t);
  await writeFile(join(f.latest, 'unrelated.txt'), 'preserve unrelated asset');
  const first = await publishBuild(await f.boot('one'), { root: f.root });
  assert.equal(first.desktopExtras, undefined);
  assert.deepEqual(first.files, ['boot-manifest.json', 'system.cpio.gz']);
  const second = await publishBuild(await f.boot('two'), { root: f.root, extrasSource: f.extras });
  for (const name of desktopExtrasFiles) {
    assert.deepEqual(await readFile(join(f.latest, name)), await readFile(join(f.extras, name)));
  }
  const third = await publishBuild(await f.boot('three'), { root: f.root });
  assert.deepEqual(third.desktopExtras, second.desktopExtras);
  assert.deepEqual(await readFile(join(f.latest, desktopExtrasFiles[0])), f.raw);
  assert.deepEqual(JSON.parse(await readFile(join(f.latest, desktopExtrasFiles[2]), 'utf8')), f.metadata);
  assert.equal(await readFile(join(f.latest, 'unrelated.txt'), 'utf8'), 'preserve unrelated asset');
  assert.equal((await readdir(f.latest)).some(name => name.startsWith('.incoming-')), false);
});

test('false gzip expansion or member inventory rejects publication before changing served files', async t => {
  const f = await fixture(t);
  await publishBuild(await f.boot('one'), { root: f.root });
  const stamp = await readFile(join(f.latest, 'latest-build.json'));
  const originalSystem = await readFile(join(f.latest, 'system.cpio.gz'));
  const next = await f.boot('two');
  const wrong = gzipSync(Buffer.from('different raw archive'));
  const changed = { ...f.metadata, gzip: { bytes: wrong.length, sha256: digest(wrong) } };
  await writeFile(join(f.extras, desktopExtrasFiles[1]), wrong);
  await writeFile(join(f.extras, desktopExtrasFiles[2]), JSON.stringify(changed));
  await assert.rejects(publishBuild(next, { root: f.root, extrasSource: f.extras }), /does not preserve/);
  await writeFile(join(f.extras, desktopExtrasFiles[1]), gzipSync(f.raw));
  const falseMembers = structuredClone(f.metadata);
  falseMembers.members[0].sha256 = '0'.repeat(64);
  await writeFile(join(f.extras, desktopExtrasFiles[2]), JSON.stringify(falseMembers));
  await assert.rejects(publishBuild(next, { root: f.root, extrasSource: f.extras }), /member hash/);
  assert.deepEqual(await readFile(join(f.latest, 'latest-build.json')), stamp);
  assert.deepEqual(await readFile(join(f.latest, 'system.cpio.gz')), originalSystem);
});

test('carried extras require the previous publication pins', async t => {
  const f = await fixture(t);
  await publishBuild(await f.boot('one'), { root: f.root, extrasSource: f.extras });
  const changed = { ...f.metadata, provenance: 'modified after publication' };
  await writeFile(join(f.latest, desktopExtrasFiles[2]), JSON.stringify(changed));
  await assert.rejects(publishBuild(await f.boot('two'), { root: f.root }), /Previously published extras changed/);
});

test('gzip size or digest mismatch is rejected', async t => {
  const f = await fixture(t);
  const changed = { ...f.metadata, gzip: { ...f.metadata.gzip, sha256: '0'.repeat(64) } };
  await writeFile(join(f.extras, desktopExtrasFiles[2]), JSON.stringify(changed));
  await assert.rejects(validateDesktopExtras(f.extras), /hash or size mismatch/);
});

test('malformed previous file lists cannot trigger publication or cleanup', async t => {
  const f = await fixture(t);
  const first = await publishBuild(await f.boot('one'), { root: f.root });
  const originalSystem = await readFile(join(f.latest, 'system.cpio.gz'));
  const originalManifest = await readFile(join(f.latest, 'boot-manifest.json'));
  await writeFile(join(f.latest, 'k'), 'preserve character-named file');
  const malformed = Buffer.from(JSON.stringify({ ...first, files: 'keep' }));
  await writeFile(join(f.latest, 'latest-build.json'), malformed);
  await assert.rejects(publishBuild(await f.boot('two'), { root: f.root }), /files must be an array/);
  assert.deepEqual(await readFile(join(f.latest, 'latest-build.json')), malformed);
  assert.deepEqual(await readFile(join(f.latest, 'system.cpio.gz')), originalSystem);
  assert.deepEqual(await readFile(join(f.latest, 'boot-manifest.json')), originalManifest);
  assert.equal(await readFile(join(f.latest, 'k'), 'utf8'), 'preserve character-named file');
  assert.equal((await readdir(f.latest)).some(name => name.startsWith('.incoming-')), false);
});
